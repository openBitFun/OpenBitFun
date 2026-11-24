//! Session storage identity. Bindings survive eviction. A pending claim never
//! becomes a read path and is rolled back when an admission future is dropped.
use dashmap::{mapref::entry::Entry, DashMap};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Debug)]
struct Binding {
    generation: Arc<()>,
    path: PathBuf,
    pending: usize,
    committed: bool,
}

#[derive(Debug)]
pub struct StorageBindings {
    bindings: DashMap<String, Binding>,
    normalize: fn(&Path) -> PathBuf,
}

impl StorageBindings {
    pub fn new(normalize: fn(&Path) -> PathBuf) -> Self {
        Self {
            bindings: Default::default(),
            normalize,
        }
    }

    fn check_path(&self, id: &str, bound: &Path, requested: &Path) -> Result<(), String> {
        let existing = (self.normalize)(bound);
        if existing != requested {
            return Err(format!("Session ID is already bound to another workspace: session_id={}, existing_storage_path={}, requested_storage_path={}", id, existing.display(), requested.display()));
        }
        Ok(())
    }

    pub fn validate(&self, id: &str, path: &Path) -> Result<(), String> {
        openbitfun_core_types::validate_session_id(id)?;
        if let Some(binding) = self.bindings.get(id) {
            self.check_path(id, &binding.path, &(self.normalize)(path))?;
        }
        Ok(())
    }

    pub fn claim(&self, id: &str, path: &Path) -> Result<StorageClaim<'_>, String> {
        openbitfun_core_types::validate_session_id(id)?;
        let path = (self.normalize)(path);
        let generation = match self.bindings.entry(id.to_owned()) {
            Entry::Vacant(entry) => {
                let generation = Arc::new(());
                entry.insert(Binding {
                    generation: generation.clone(),
                    path,
                    pending: 1,
                    committed: false,
                });
                Some(generation)
            }
            Entry::Occupied(mut entry) => {
                self.check_path(id, &entry.get().path, &path)?;
                let binding = entry.get_mut();
                if binding.committed {
                    None
                } else {
                    binding.pending += 1;
                    Some(binding.generation.clone())
                }
            }
        };
        Ok(StorageClaim {
            owner: self,
            id: id.to_owned(),
            generation,
        })
    }

    pub fn committed_path(&self, id: &str) -> Option<PathBuf> {
        self.bindings
            .get(id)
            .filter(|binding| binding.committed)
            .map(|binding| binding.path.clone())
    }

    pub fn path(&self, id: &str) -> Option<PathBuf> {
        self.bindings.get(id).map(|binding| binding.path.clone())
    }

    pub fn bind(&self, id: &str, path: PathBuf) {
        self.bindings.insert(
            id.to_owned(),
            Binding {
                generation: Arc::new(()),
                path,
                pending: 0,
                committed: true,
            },
        );
    }

    pub fn remove(&self, id: &str) {
        self.bindings.remove(id);
    }
}

#[must_use]
#[derive(Debug)]
pub struct StorageClaim<'a> {
    owner: &'a StorageBindings,
    id: String,
    generation: Option<Arc<()>>,
}

impl StorageClaim<'_> {
    pub fn commit(mut self) {
        if let Some(generation) = self.generation.take() {
            if let Some(mut binding) = self.owner.bindings.get_mut(&self.id) {
                if Arc::ptr_eq(&binding.generation, &generation) {
                    binding.committed = true;
                    binding.pending = 0;
                }
            }
        }
    }
}

impl Drop for StorageClaim<'_> {
    fn drop(&mut self) {
        if let Some(generation) = self.generation.take() {
            if let Entry::Occupied(mut entry) = self.owner.bindings.entry(self.id.clone()) {
                let binding = entry.get_mut();
                if !binding.committed && Arc::ptr_eq(&binding.generation, &generation) {
                    binding.pending -= 1;
                    if binding.pending == 0 {
                        entry.remove();
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_abandoned_admission_releases_only_its_own_generation() {
        let index = StorageBindings::new(Path::to_path_buf);
        let path = Path::new("workspace");
        let old = index.claim("session", path).unwrap();
        index.remove("session");
        let new = index.claim("session", path).unwrap();
        drop(old);
        assert_eq!(index.path("session").as_deref(), Some(path));
        assert!(index.committed_path("session").is_none());
        drop(new);
        assert!(index.path("session").is_none());
    }
}
