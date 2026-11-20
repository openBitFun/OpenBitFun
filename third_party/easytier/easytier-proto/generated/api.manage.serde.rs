impl serde::Serialize for CollectNetworkInfoRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.CollectNetworkInfoRequest", len)?;
        if !self.inst_ids.is_empty() {
            struct_ser.serialize_field("inst_ids", &self.inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CollectNetworkInfoRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_ids",
            "instIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instIds" | "inst_ids" => Ok(GeneratedField::InstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CollectNetworkInfoRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.CollectNetworkInfoRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CollectNetworkInfoRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstIds => {
                            if inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instIds"));
                            }
                            inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CollectNetworkInfoRequest {
                    inst_ids: inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.CollectNetworkInfoRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for CollectNetworkInfoResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.info.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.CollectNetworkInfoResponse", len)?;
        if let Some(v) = self.info.as_ref() {
            struct_ser.serialize_field("info", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CollectNetworkInfoResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "info",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Info,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "info" => Ok(GeneratedField::Info),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CollectNetworkInfoResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.CollectNetworkInfoResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CollectNetworkInfoResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut info__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Info => {
                            if info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("info"));
                            }
                            info__ = map_.next_value()?;
                        }
                    }
                }
                Ok(CollectNetworkInfoResponse {
                    info: info__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.CollectNetworkInfoResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ConfigSource {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "ConfigSourceUnspecified",
            Self::User => "ConfigSourceUser",
            Self::Web => "ConfigSourceWeb",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for ConfigSource {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "ConfigSourceUnspecified",
            "ConfigSourceUser",
            "ConfigSourceWeb",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = ConfigSource;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(formatter, "expected one of: {:?}", &FIELDS)
            }

            fn visit_i64<E>(self, v: i64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Signed(v), &self)
                    })
            }

            fn visit_u64<E>(self, v: u64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Unsigned(v), &self)
                    })
            }

            fn visit_str<E>(self, value: &str) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match value {
                    "ConfigSourceUnspecified" => Ok(ConfigSource::Unspecified),
                    "ConfigSourceUser" => Ok(ConfigSource::User),
                    "ConfigSourceWeb" => Ok(ConfigSource::Web),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteNetworkInstanceRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.DeleteNetworkInstanceRequest", len)?;
        if !self.inst_ids.is_empty() {
            struct_ser.serialize_field("inst_ids", &self.inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteNetworkInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_ids",
            "instIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instIds" | "inst_ids" => Ok(GeneratedField::InstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteNetworkInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.DeleteNetworkInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteNetworkInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstIds => {
                            if inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instIds"));
                            }
                            inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteNetworkInstanceRequest {
                    inst_ids: inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.DeleteNetworkInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DeleteNetworkInstanceResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.remain_inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.DeleteNetworkInstanceResponse", len)?;
        if !self.remain_inst_ids.is_empty() {
            struct_ser.serialize_field("remain_inst_ids", &self.remain_inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeleteNetworkInstanceResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "remain_inst_ids",
            "remainInstIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            RemainInstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "remainInstIds" | "remain_inst_ids" => Ok(GeneratedField::RemainInstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeleteNetworkInstanceResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.DeleteNetworkInstanceResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeleteNetworkInstanceResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut remain_inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::RemainInstIds => {
                            if remain_inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("remainInstIds"));
                            }
                            remain_inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeleteNetworkInstanceResponse {
                    remain_inst_ids: remain_inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.DeleteNetworkInstanceResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetNetworkInstanceConfigRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.inst_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.GetNetworkInstanceConfigRequest", len)?;
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetNetworkInstanceConfigRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_id",
            "instId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstId,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetNetworkInstanceConfigRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.GetNetworkInstanceConfigRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetNetworkInstanceConfigRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetNetworkInstanceConfigRequest {
                    inst_id: inst_id__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.GetNetworkInstanceConfigRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetNetworkInstanceConfigResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.config.is_some() {
            len += 1;
        }
        if self.source != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.GetNetworkInstanceConfigResponse", len)?;
        if let Some(v) = self.config.as_ref() {
            struct_ser.serialize_field("config", v)?;
        }
        if self.source != 0 {
            let v = ConfigSource::try_from(self.source)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.source)))?;
            struct_ser.serialize_field("source", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetNetworkInstanceConfigResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "config",
            "source",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Config,
            Source,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "config" => Ok(GeneratedField::Config),
                            "source" => Ok(GeneratedField::Source),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetNetworkInstanceConfigResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.GetNetworkInstanceConfigResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetNetworkInstanceConfigResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut config__ = None;
                let mut source__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Config => {
                            if config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("config"));
                            }
                            config__ = map_.next_value()?;
                        }
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value::<ConfigSource>()? as i32);
                        }
                    }
                }
                Ok(GetNetworkInstanceConfigResponse {
                    config: config__,
                    source: source__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.GetNetworkInstanceConfigResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListNetworkInstanceMetaRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ListNetworkInstanceMetaRequest", len)?;
        if !self.inst_ids.is_empty() {
            struct_ser.serialize_field("inst_ids", &self.inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListNetworkInstanceMetaRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_ids",
            "instIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instIds" | "inst_ids" => Ok(GeneratedField::InstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListNetworkInstanceMetaRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ListNetworkInstanceMetaRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListNetworkInstanceMetaRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstIds => {
                            if inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instIds"));
                            }
                            inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListNetworkInstanceMetaRequest {
                    inst_ids: inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ListNetworkInstanceMetaRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListNetworkInstanceMetaResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.metas.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ListNetworkInstanceMetaResponse", len)?;
        if !self.metas.is_empty() {
            struct_ser.serialize_field("metas", &self.metas)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListNetworkInstanceMetaResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "metas",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Metas,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "metas" => Ok(GeneratedField::Metas),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListNetworkInstanceMetaResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ListNetworkInstanceMetaResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListNetworkInstanceMetaResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut metas__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Metas => {
                            if metas__.is_some() {
                                return Err(serde::de::Error::duplicate_field("metas"));
                            }
                            metas__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListNetworkInstanceMetaResponse {
                    metas: metas__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ListNetworkInstanceMetaResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListNetworkInstanceRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("api.manage.ListNetworkInstanceRequest", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListNetworkInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                            Err(serde::de::Error::unknown_field(value, FIELDS))
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListNetworkInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ListNetworkInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListNetworkInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(ListNetworkInstanceRequest {
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ListNetworkInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListNetworkInstanceResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ListNetworkInstanceResponse", len)?;
        if !self.inst_ids.is_empty() {
            struct_ser.serialize_field("inst_ids", &self.inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListNetworkInstanceResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_ids",
            "instIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instIds" | "inst_ids" => Ok(GeneratedField::InstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListNetworkInstanceResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ListNetworkInstanceResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListNetworkInstanceResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstIds => {
                            if inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instIds"));
                            }
                            inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListNetworkInstanceResponse {
                    inst_ids: inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ListNetworkInstanceResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ManagedCredentialConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.credential_id.is_empty() {
            len += 1;
        }
        if !self.credential_secret.is_empty() {
            len += 1;
        }
        if !self.groups.is_empty() {
            len += 1;
        }
        if self.allow_relay {
            len += 1;
        }
        if !self.allowed_proxy_cidrs.is_empty() {
            len += 1;
        }
        if self.expiry_unix != 0 {
            len += 1;
        }
        if self.reusable.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ManagedCredentialConfig", len)?;
        if !self.credential_id.is_empty() {
            struct_ser.serialize_field("credential_id", &self.credential_id)?;
        }
        if !self.credential_secret.is_empty() {
            struct_ser.serialize_field("credential_secret", &self.credential_secret)?;
        }
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        if self.allow_relay {
            struct_ser.serialize_field("allow_relay", &self.allow_relay)?;
        }
        if !self.allowed_proxy_cidrs.is_empty() {
            struct_ser.serialize_field("allowed_proxy_cidrs", &self.allowed_proxy_cidrs)?;
        }
        if self.expiry_unix != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expiry_unix", ToString::to_string(&self.expiry_unix).as_str())?;
        }
        if let Some(v) = self.reusable.as_ref() {
            struct_ser.serialize_field("reusable", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ManagedCredentialConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "credential_id",
            "credentialId",
            "credential_secret",
            "credentialSecret",
            "groups",
            "allow_relay",
            "allowRelay",
            "allowed_proxy_cidrs",
            "allowedProxyCidrs",
            "expiry_unix",
            "expiryUnix",
            "reusable",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CredentialId,
            CredentialSecret,
            Groups,
            AllowRelay,
            AllowedProxyCidrs,
            ExpiryUnix,
            Reusable,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "credentialId" | "credential_id" => Ok(GeneratedField::CredentialId),
                            "credentialSecret" | "credential_secret" => Ok(GeneratedField::CredentialSecret),
                            "groups" => Ok(GeneratedField::Groups),
                            "allowRelay" | "allow_relay" => Ok(GeneratedField::AllowRelay),
                            "allowedProxyCidrs" | "allowed_proxy_cidrs" => Ok(GeneratedField::AllowedProxyCidrs),
                            "expiryUnix" | "expiry_unix" => Ok(GeneratedField::ExpiryUnix),
                            "reusable" => Ok(GeneratedField::Reusable),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ManagedCredentialConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ManagedCredentialConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ManagedCredentialConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut credential_id__ = None;
                let mut credential_secret__ = None;
                let mut groups__ = None;
                let mut allow_relay__ = None;
                let mut allowed_proxy_cidrs__ = None;
                let mut expiry_unix__ = None;
                let mut reusable__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CredentialId => {
                            if credential_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialId"));
                            }
                            credential_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::CredentialSecret => {
                            if credential_secret__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialSecret"));
                            }
                            credential_secret__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Groups => {
                            if groups__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groups"));
                            }
                            groups__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AllowRelay => {
                            if allow_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("allowRelay"));
                            }
                            allow_relay__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AllowedProxyCidrs => {
                            if allowed_proxy_cidrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("allowedProxyCidrs"));
                            }
                            allowed_proxy_cidrs__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ExpiryUnix => {
                            if expiry_unix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiryUnix"));
                            }
                            expiry_unix__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Reusable => {
                            if reusable__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reusable"));
                            }
                            reusable__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ManagedCredentialConfig {
                    credential_id: credential_id__.unwrap_or_default(),
                    credential_secret: credential_secret__.unwrap_or_default(),
                    groups: groups__.unwrap_or_default(),
                    allow_relay: allow_relay__.unwrap_or_default(),
                    allowed_proxy_cidrs: allowed_proxy_cidrs__.unwrap_or_default(),
                    expiry_unix: expiry_unix__.unwrap_or_default(),
                    reusable: reusable__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ManagedCredentialConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ManagedCredentialSet {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.entries.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ManagedCredentialSet", len)?;
        if !self.entries.is_empty() {
            struct_ser.serialize_field("entries", &self.entries)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ManagedCredentialSet {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "entries",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Entries,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "entries" => Ok(GeneratedField::Entries),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ManagedCredentialSet;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ManagedCredentialSet")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ManagedCredentialSet, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut entries__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Entries => {
                            if entries__.is_some() {
                                return Err(serde::de::Error::duplicate_field("entries"));
                            }
                            entries__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ManagedCredentialSet {
                    entries: entries__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ManagedCredentialSet", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for MyNodeInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.virtual_ipv4.is_some() {
            len += 1;
        }
        if !self.hostname.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if self.ips.is_some() {
            len += 1;
        }
        if self.stun_info.is_some() {
            len += 1;
        }
        if !self.listeners.is_empty() {
            len += 1;
        }
        if self.vpn_portal_cfg.is_some() {
            len += 1;
        }
        if self.peer_id != 0 {
            len += 1;
        }
        if self.virtual_ipv6.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.MyNodeInfo", len)?;
        if let Some(v) = self.virtual_ipv4.as_ref() {
            struct_ser.serialize_field("virtual_ipv4", v)?;
        }
        if !self.hostname.is_empty() {
            struct_ser.serialize_field("hostname", &self.hostname)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if let Some(v) = self.ips.as_ref() {
            struct_ser.serialize_field("ips", v)?;
        }
        if let Some(v) = self.stun_info.as_ref() {
            struct_ser.serialize_field("stun_info", v)?;
        }
        if !self.listeners.is_empty() {
            struct_ser.serialize_field("listeners", &self.listeners)?;
        }
        if let Some(v) = self.vpn_portal_cfg.as_ref() {
            struct_ser.serialize_field("vpn_portal_cfg", v)?;
        }
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.virtual_ipv6.as_ref() {
            struct_ser.serialize_field("virtual_ipv6", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for MyNodeInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "virtual_ipv4",
            "virtualIpv4",
            "hostname",
            "version",
            "ips",
            "stun_info",
            "stunInfo",
            "listeners",
            "vpn_portal_cfg",
            "vpnPortalCfg",
            "peer_id",
            "peerId",
            "virtual_ipv6",
            "virtualIpv6",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            VirtualIpv4,
            Hostname,
            Version,
            Ips,
            StunInfo,
            Listeners,
            VpnPortalCfg,
            PeerId,
            VirtualIpv6,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "virtualIpv4" | "virtual_ipv4" => Ok(GeneratedField::VirtualIpv4),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "version" => Ok(GeneratedField::Version),
                            "ips" => Ok(GeneratedField::Ips),
                            "stunInfo" | "stun_info" => Ok(GeneratedField::StunInfo),
                            "listeners" => Ok(GeneratedField::Listeners),
                            "vpnPortalCfg" | "vpn_portal_cfg" => Ok(GeneratedField::VpnPortalCfg),
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
                            "virtualIpv6" | "virtual_ipv6" => Ok(GeneratedField::VirtualIpv6),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = MyNodeInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.MyNodeInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<MyNodeInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut virtual_ipv4__ = None;
                let mut hostname__ = None;
                let mut version__ = None;
                let mut ips__ = None;
                let mut stun_info__ = None;
                let mut listeners__ = None;
                let mut vpn_portal_cfg__ = None;
                let mut peer_id__ = None;
                let mut virtual_ipv6__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::VirtualIpv4 => {
                            if virtual_ipv4__.is_some() {
                                return Err(serde::de::Error::duplicate_field("virtualIpv4"));
                            }
                            virtual_ipv4__ = map_.next_value()?;
                        }
                        GeneratedField::Hostname => {
                            if hostname__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hostname"));
                            }
                            hostname__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Ips => {
                            if ips__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ips"));
                            }
                            ips__ = map_.next_value()?;
                        }
                        GeneratedField::StunInfo => {
                            if stun_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stunInfo"));
                            }
                            stun_info__ = map_.next_value()?;
                        }
                        GeneratedField::Listeners => {
                            if listeners__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listeners"));
                            }
                            listeners__ = Some(map_.next_value()?);
                        }
                        GeneratedField::VpnPortalCfg => {
                            if vpn_portal_cfg__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalCfg"));
                            }
                            vpn_portal_cfg__ = map_.next_value()?;
                        }
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::VirtualIpv6 => {
                            if virtual_ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("virtualIpv6"));
                            }
                            virtual_ipv6__ = map_.next_value()?;
                        }
                    }
                }
                Ok(MyNodeInfo {
                    virtual_ipv4: virtual_ipv4__,
                    hostname: hostname__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    ips: ips__,
                    stun_info: stun_info__,
                    listeners: listeners__.unwrap_or_default(),
                    vpn_portal_cfg: vpn_portal_cfg__,
                    peer_id: peer_id__.unwrap_or_default(),
                    virtual_ipv6: virtual_ipv6__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.MyNodeInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NetworkConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance_id.is_some() {
            len += 1;
        }
        if self.dhcp.is_some() {
            len += 1;
        }
        if self.virtual_ipv4.is_some() {
            len += 1;
        }
        if self.network_length.is_some() {
            len += 1;
        }
        if self.hostname.is_some() {
            len += 1;
        }
        if self.network_name.is_some() {
            len += 1;
        }
        if self.network_secret.is_some() {
            len += 1;
        }
        if self.networking_method.is_some() {
            len += 1;
        }
        if self.public_server_url.is_some() {
            len += 1;
        }
        if !self.peer_urls.is_empty() {
            len += 1;
        }
        if !self.proxy_cidrs.is_empty() {
            len += 1;
        }
        if self.enable_vpn_portal.is_some() {
            len += 1;
        }
        if self.vpn_portal_listen_port.is_some() {
            len += 1;
        }
        if self.vpn_portal_client_network_addr.is_some() {
            len += 1;
        }
        if self.vpn_portal_client_network_len.is_some() {
            len += 1;
        }
        if self.advanced_settings.is_some() {
            len += 1;
        }
        if !self.listener_urls.is_empty() {
            len += 1;
        }
        if self.latency_first.is_some() {
            len += 1;
        }
        if self.dev_name.is_some() {
            len += 1;
        }
        if self.use_smoltcp.is_some() {
            len += 1;
        }
        if self.disable_ipv6.is_some() {
            len += 1;
        }
        if self.tld_dns_zone.is_some() {
            len += 1;
        }
        if self.enable_kcp_proxy.is_some() {
            len += 1;
        }
        if self.disable_kcp_input.is_some() {
            len += 1;
        }
        if self.disable_p2p.is_some() {
            len += 1;
        }
        if self.bind_device.is_some() {
            len += 1;
        }
        if self.no_tun.is_some() {
            len += 1;
        }
        if self.enable_exit_node.is_some() {
            len += 1;
        }
        if self.relay_all_peer_rpc.is_some() {
            len += 1;
        }
        if self.multi_thread.is_some() {
            len += 1;
        }
        if self.enable_relay_network_whitelist.is_some() {
            len += 1;
        }
        if !self.relay_network_whitelist.is_empty() {
            len += 1;
        }
        if self.enable_manual_routes.is_some() {
            len += 1;
        }
        if !self.routes.is_empty() {
            len += 1;
        }
        if !self.exit_nodes.is_empty() {
            len += 1;
        }
        if self.proxy_forward_by_system.is_some() {
            len += 1;
        }
        if self.disable_encryption.is_some() {
            len += 1;
        }
        if self.enable_socks5.is_some() {
            len += 1;
        }
        if self.socks5_port.is_some() {
            len += 1;
        }
        if self.disable_udp_hole_punching.is_some() {
            len += 1;
        }
        if self.mtu.is_some() {
            len += 1;
        }
        if !self.mapped_listeners.is_empty() {
            len += 1;
        }
        if self.enable_magic_dns.is_some() {
            len += 1;
        }
        if self.enable_private_mode.is_some() {
            len += 1;
        }
        if self.enable_quic_proxy.is_some() {
            len += 1;
        }
        if self.disable_quic_input.is_some() {
            len += 1;
        }
        if self.quic_listen_port.is_some() {
            len += 1;
        }
        if !self.port_forwards.is_empty() {
            len += 1;
        }
        if self.disable_sym_hole_punching.is_some() {
            len += 1;
        }
        if self.p2p_only.is_some() {
            len += 1;
        }
        if self.data_compress_algo.is_some() {
            len += 1;
        }
        if self.encryption_algorithm.is_some() {
            len += 1;
        }
        if self.disable_tcp_hole_punching.is_some() {
            len += 1;
        }
        if self.secure_mode.is_some() {
            len += 1;
        }
        if self.acl.is_some() {
            len += 1;
        }
        if self.credential_file.is_some() {
            len += 1;
        }
        if self.lazy_p2p.is_some() {
            len += 1;
        }
        if self.need_p2p.is_some() {
            len += 1;
        }
        if self.instance_recv_bps_limit.is_some() {
            len += 1;
        }
        if self.disable_upnp.is_some() {
            len += 1;
        }
        if self.ipv6_public_addr_provider.is_some() {
            len += 1;
        }
        if self.ipv6_public_addr_auto.is_some() {
            len += 1;
        }
        if self.ipv6_public_addr_prefix.is_some() {
            len += 1;
        }
        if self.disable_relay_data.is_some() {
            len += 1;
        }
        if self.enable_udp_broadcast_relay.is_some() {
            len += 1;
        }
        if self.socket_mark.is_some() {
            len += 1;
        }
        if !self.peers.is_empty() {
            len += 1;
        }
        if self.vpn_portal_config.is_some() {
            len += 1;
        }
        if !self.managed_credentials.is_empty() {
            len += 1;
        }
        if self.prefer_peer_relay.is_some() {
            len += 1;
        }
        if self.dhcp_ipv4_cidr.is_some() {
            len += 1;
        }
        if self.dhcpv6.is_some() {
            len += 1;
        }
        if self.dhcp_ipv6_cidr.is_some() {
            len += 1;
        }
        if self.dns.is_some() {
            len += 1;
        }
        if self.enable_udp_fec.is_some() {
            len += 1;
        }
        if self.enable_udp_fec_kcp.is_some() {
            len += 1;
        }
        if self.enable_udp_fec_quic.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.NetworkConfig", len)?;
        if let Some(v) = self.instance_id.as_ref() {
            struct_ser.serialize_field("instance_id", v)?;
        }
        if let Some(v) = self.dhcp.as_ref() {
            struct_ser.serialize_field("dhcp", v)?;
        }
        if let Some(v) = self.virtual_ipv4.as_ref() {
            struct_ser.serialize_field("virtual_ipv4", v)?;
        }
        if let Some(v) = self.network_length.as_ref() {
            struct_ser.serialize_field("network_length", v)?;
        }
        if let Some(v) = self.hostname.as_ref() {
            struct_ser.serialize_field("hostname", v)?;
        }
        if let Some(v) = self.network_name.as_ref() {
            struct_ser.serialize_field("network_name", v)?;
        }
        if let Some(v) = self.network_secret.as_ref() {
            struct_ser.serialize_field("network_secret", v)?;
        }
        if let Some(v) = self.networking_method.as_ref() {
            let v = NetworkingMethod::try_from(*v)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", *v)))?;
            struct_ser.serialize_field("networking_method", &v)?;
        }
        if let Some(v) = self.public_server_url.as_ref() {
            struct_ser.serialize_field("public_server_url", v)?;
        }
        if !self.peer_urls.is_empty() {
            struct_ser.serialize_field("peer_urls", &self.peer_urls)?;
        }
        if !self.proxy_cidrs.is_empty() {
            struct_ser.serialize_field("proxy_cidrs", &self.proxy_cidrs)?;
        }
        if let Some(v) = self.enable_vpn_portal.as_ref() {
            struct_ser.serialize_field("enable_vpn_portal", v)?;
        }
        if let Some(v) = self.vpn_portal_listen_port.as_ref() {
            struct_ser.serialize_field("vpn_portal_listen_port", v)?;
        }
        if let Some(v) = self.vpn_portal_client_network_addr.as_ref() {
            struct_ser.serialize_field("vpn_portal_client_network_addr", v)?;
        }
        if let Some(v) = self.vpn_portal_client_network_len.as_ref() {
            struct_ser.serialize_field("vpn_portal_client_network_len", v)?;
        }
        if let Some(v) = self.advanced_settings.as_ref() {
            struct_ser.serialize_field("advanced_settings", v)?;
        }
        if !self.listener_urls.is_empty() {
            struct_ser.serialize_field("listener_urls", &self.listener_urls)?;
        }
        if let Some(v) = self.latency_first.as_ref() {
            struct_ser.serialize_field("latency_first", v)?;
        }
        if let Some(v) = self.dev_name.as_ref() {
            struct_ser.serialize_field("dev_name", v)?;
        }
        if let Some(v) = self.use_smoltcp.as_ref() {
            struct_ser.serialize_field("use_smoltcp", v)?;
        }
        if let Some(v) = self.disable_ipv6.as_ref() {
            struct_ser.serialize_field("disable_ipv6", v)?;
        }
        if let Some(v) = self.tld_dns_zone.as_ref() {
            struct_ser.serialize_field("tld_dns_zone", v)?;
        }
        if let Some(v) = self.enable_kcp_proxy.as_ref() {
            struct_ser.serialize_field("enable_kcp_proxy", v)?;
        }
        if let Some(v) = self.disable_kcp_input.as_ref() {
            struct_ser.serialize_field("disable_kcp_input", v)?;
        }
        if let Some(v) = self.disable_p2p.as_ref() {
            struct_ser.serialize_field("disable_p2p", v)?;
        }
        if let Some(v) = self.bind_device.as_ref() {
            struct_ser.serialize_field("bind_device", v)?;
        }
        if let Some(v) = self.no_tun.as_ref() {
            struct_ser.serialize_field("no_tun", v)?;
        }
        if let Some(v) = self.enable_exit_node.as_ref() {
            struct_ser.serialize_field("enable_exit_node", v)?;
        }
        if let Some(v) = self.relay_all_peer_rpc.as_ref() {
            struct_ser.serialize_field("relay_all_peer_rpc", v)?;
        }
        if let Some(v) = self.multi_thread.as_ref() {
            struct_ser.serialize_field("multi_thread", v)?;
        }
        if let Some(v) = self.enable_relay_network_whitelist.as_ref() {
            struct_ser.serialize_field("enable_relay_network_whitelist", v)?;
        }
        if !self.relay_network_whitelist.is_empty() {
            struct_ser.serialize_field("relay_network_whitelist", &self.relay_network_whitelist)?;
        }
        if let Some(v) = self.enable_manual_routes.as_ref() {
            struct_ser.serialize_field("enable_manual_routes", v)?;
        }
        if !self.routes.is_empty() {
            struct_ser.serialize_field("routes", &self.routes)?;
        }
        if !self.exit_nodes.is_empty() {
            struct_ser.serialize_field("exit_nodes", &self.exit_nodes)?;
        }
        if let Some(v) = self.proxy_forward_by_system.as_ref() {
            struct_ser.serialize_field("proxy_forward_by_system", v)?;
        }
        if let Some(v) = self.disable_encryption.as_ref() {
            struct_ser.serialize_field("disable_encryption", v)?;
        }
        if let Some(v) = self.enable_socks5.as_ref() {
            struct_ser.serialize_field("enable_socks5", v)?;
        }
        if let Some(v) = self.socks5_port.as_ref() {
            struct_ser.serialize_field("socks5_port", v)?;
        }
        if let Some(v) = self.disable_udp_hole_punching.as_ref() {
            struct_ser.serialize_field("disable_udp_hole_punching", v)?;
        }
        if let Some(v) = self.mtu.as_ref() {
            struct_ser.serialize_field("mtu", v)?;
        }
        if !self.mapped_listeners.is_empty() {
            struct_ser.serialize_field("mapped_listeners", &self.mapped_listeners)?;
        }
        if let Some(v) = self.enable_magic_dns.as_ref() {
            struct_ser.serialize_field("enable_magic_dns", v)?;
        }
        if let Some(v) = self.enable_private_mode.as_ref() {
            struct_ser.serialize_field("enable_private_mode", v)?;
        }
        if let Some(v) = self.enable_quic_proxy.as_ref() {
            struct_ser.serialize_field("enable_quic_proxy", v)?;
        }
        if let Some(v) = self.disable_quic_input.as_ref() {
            struct_ser.serialize_field("disable_quic_input", v)?;
        }
        if let Some(v) = self.quic_listen_port.as_ref() {
            struct_ser.serialize_field("quic_listen_port", v)?;
        }
        if !self.port_forwards.is_empty() {
            struct_ser.serialize_field("port_forwards", &self.port_forwards)?;
        }
        if let Some(v) = self.disable_sym_hole_punching.as_ref() {
            struct_ser.serialize_field("disable_sym_hole_punching", v)?;
        }
        if let Some(v) = self.p2p_only.as_ref() {
            struct_ser.serialize_field("p2p_only", v)?;
        }
        if let Some(v) = self.data_compress_algo.as_ref() {
            let v = super::super::common::CompressionAlgoPb::try_from(*v)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", *v)))?;
            struct_ser.serialize_field("data_compress_algo", &v)?;
        }
        if let Some(v) = self.encryption_algorithm.as_ref() {
            struct_ser.serialize_field("encryption_algorithm", v)?;
        }
        if let Some(v) = self.disable_tcp_hole_punching.as_ref() {
            struct_ser.serialize_field("disable_tcp_hole_punching", v)?;
        }
        if let Some(v) = self.secure_mode.as_ref() {
            struct_ser.serialize_field("secure_mode", v)?;
        }
        if let Some(v) = self.acl.as_ref() {
            struct_ser.serialize_field("acl", v)?;
        }
        if let Some(v) = self.credential_file.as_ref() {
            struct_ser.serialize_field("credential_file", v)?;
        }
        if let Some(v) = self.lazy_p2p.as_ref() {
            struct_ser.serialize_field("lazy_p2p", v)?;
        }
        if let Some(v) = self.need_p2p.as_ref() {
            struct_ser.serialize_field("need_p2p", v)?;
        }
        if let Some(v) = self.instance_recv_bps_limit.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("instance_recv_bps_limit", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.disable_upnp.as_ref() {
            struct_ser.serialize_field("disable_upnp", v)?;
        }
        if let Some(v) = self.ipv6_public_addr_provider.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_provider", v)?;
        }
        if let Some(v) = self.ipv6_public_addr_auto.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_auto", v)?;
        }
        if let Some(v) = self.ipv6_public_addr_prefix.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_prefix", v)?;
        }
        if let Some(v) = self.disable_relay_data.as_ref() {
            struct_ser.serialize_field("disable_relay_data", v)?;
        }
        if let Some(v) = self.enable_udp_broadcast_relay.as_ref() {
            struct_ser.serialize_field("enable_udp_broadcast_relay", v)?;
        }
        if let Some(v) = self.socket_mark.as_ref() {
            struct_ser.serialize_field("socket_mark", v)?;
        }
        if !self.peers.is_empty() {
            struct_ser.serialize_field("peers", &self.peers)?;
        }
        if let Some(v) = self.vpn_portal_config.as_ref() {
            struct_ser.serialize_field("vpn_portal_config", v)?;
        }
        if !self.managed_credentials.is_empty() {
            struct_ser.serialize_field("managed_credentials", &self.managed_credentials)?;
        }
        if let Some(v) = self.prefer_peer_relay.as_ref() {
            struct_ser.serialize_field("prefer_peer_relay", v)?;
        }
        if let Some(v) = self.dhcp_ipv4_cidr.as_ref() {
            struct_ser.serialize_field("dhcp_ipv4_cidr", v)?;
        }
        if let Some(v) = self.dhcpv6.as_ref() {
            struct_ser.serialize_field("dhcpv6", v)?;
        }
        if let Some(v) = self.dhcp_ipv6_cidr.as_ref() {
            struct_ser.serialize_field("dhcp_ipv6_cidr", v)?;
        }
        if let Some(v) = self.dns.as_ref() {
            struct_ser.serialize_field("dns", v)?;
        }
        if let Some(v) = self.enable_udp_fec.as_ref() {
            struct_ser.serialize_field("enable_udp_fec", v)?;
        }
        if let Some(v) = self.enable_udp_fec_kcp.as_ref() {
            struct_ser.serialize_field("enable_udp_fec_kcp", v)?;
        }
        if let Some(v) = self.enable_udp_fec_quic.as_ref() {
            struct_ser.serialize_field("enable_udp_fec_quic", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NetworkConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance_id",
            "instanceId",
            "dhcp",
            "virtual_ipv4",
            "virtualIpv4",
            "network_length",
            "networkLength",
            "hostname",
            "network_name",
            "networkName",
            "network_secret",
            "networkSecret",
            "networking_method",
            "networkingMethod",
            "public_server_url",
            "publicServerUrl",
            "peer_urls",
            "peerUrls",
            "proxy_cidrs",
            "proxyCidrs",
            "enable_vpn_portal",
            "enableVpnPortal",
            "vpn_portal_listen_port",
            "vpnPortalListenPort",
            "vpn_portal_client_network_addr",
            "vpnPortalClientNetworkAddr",
            "vpn_portal_client_network_len",
            "vpnPortalClientNetworkLen",
            "advanced_settings",
            "advancedSettings",
            "listener_urls",
            "listenerUrls",
            "latency_first",
            "latencyFirst",
            "dev_name",
            "devName",
            "use_smoltcp",
            "useSmoltcp",
            "disable_ipv6",
            "disableIpv6",
            "tld_dns_zone",
            "tldDnsZone",
            "enable_kcp_proxy",
            "enableKcpProxy",
            "disable_kcp_input",
            "disableKcpInput",
            "disable_p2p",
            "disableP2p",
            "bind_device",
            "bindDevice",
            "no_tun",
            "noTun",
            "enable_exit_node",
            "enableExitNode",
            "relay_all_peer_rpc",
            "relayAllPeerRpc",
            "multi_thread",
            "multiThread",
            "enable_relay_network_whitelist",
            "enableRelayNetworkWhitelist",
            "relay_network_whitelist",
            "relayNetworkWhitelist",
            "enable_manual_routes",
            "enableManualRoutes",
            "routes",
            "exit_nodes",
            "exitNodes",
            "proxy_forward_by_system",
            "proxyForwardBySystem",
            "disable_encryption",
            "disableEncryption",
            "enable_socks5",
            "enableSocks5",
            "socks5_port",
            "socks5Port",
            "disable_udp_hole_punching",
            "disableUdpHolePunching",
            "mtu",
            "mapped_listeners",
            "mappedListeners",
            "enable_magic_dns",
            "enableMagicDns",
            "enable_private_mode",
            "enablePrivateMode",
            "enable_quic_proxy",
            "enableQuicProxy",
            "disable_quic_input",
            "disableQuicInput",
            "quic_listen_port",
            "quicListenPort",
            "port_forwards",
            "portForwards",
            "disable_sym_hole_punching",
            "disableSymHolePunching",
            "p2p_only",
            "p2pOnly",
            "data_compress_algo",
            "dataCompressAlgo",
            "encryption_algorithm",
            "encryptionAlgorithm",
            "disable_tcp_hole_punching",
            "disableTcpHolePunching",
            "secure_mode",
            "secureMode",
            "acl",
            "credential_file",
            "credentialFile",
            "lazy_p2p",
            "lazyP2p",
            "need_p2p",
            "needP2p",
            "instance_recv_bps_limit",
            "instanceRecvBpsLimit",
            "disable_upnp",
            "disableUpnp",
            "ipv6_public_addr_provider",
            "ipv6PublicAddrProvider",
            "ipv6_public_addr_auto",
            "ipv6PublicAddrAuto",
            "ipv6_public_addr_prefix",
            "ipv6PublicAddrPrefix",
            "disable_relay_data",
            "disableRelayData",
            "enable_udp_broadcast_relay",
            "enableUdpBroadcastRelay",
            "socket_mark",
            "socketMark",
            "peers",
            "vpn_portal_config",
            "vpnPortalConfig",
            "managed_credentials",
            "managedCredentials",
            "prefer_peer_relay",
            "preferPeerRelay",
            "dhcp_ipv4_cidr",
            "dhcpIpv4Cidr",
            "dhcpv6",
            "dhcp_ipv6_cidr",
            "dhcpIpv6Cidr",
            "dns",
            "enable_udp_fec",
            "enableUdpFec",
            "enable_udp_fec_kcp",
            "enableUdpFecKcp",
            "enable_udp_fec_quic",
            "enableUdpFecQuic",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstanceId,
            Dhcp,
            VirtualIpv4,
            NetworkLength,
            Hostname,
            NetworkName,
            NetworkSecret,
            NetworkingMethod,
            PublicServerUrl,
            PeerUrls,
            ProxyCidrs,
            EnableVpnPortal,
            VpnPortalListenPort,
            VpnPortalClientNetworkAddr,
            VpnPortalClientNetworkLen,
            AdvancedSettings,
            ListenerUrls,
            LatencyFirst,
            DevName,
            UseSmoltcp,
            DisableIpv6,
            TldDnsZone,
            EnableKcpProxy,
            DisableKcpInput,
            DisableP2p,
            BindDevice,
            NoTun,
            EnableExitNode,
            RelayAllPeerRpc,
            MultiThread,
            EnableRelayNetworkWhitelist,
            RelayNetworkWhitelist,
            EnableManualRoutes,
            Routes,
            ExitNodes,
            ProxyForwardBySystem,
            DisableEncryption,
            EnableSocks5,
            Socks5Port,
            DisableUdpHolePunching,
            Mtu,
            MappedListeners,
            EnableMagicDns,
            EnablePrivateMode,
            EnableQuicProxy,
            DisableQuicInput,
            QuicListenPort,
            PortForwards,
            DisableSymHolePunching,
            P2pOnly,
            DataCompressAlgo,
            EncryptionAlgorithm,
            DisableTcpHolePunching,
            SecureMode,
            Acl,
            CredentialFile,
            LazyP2p,
            NeedP2p,
            InstanceRecvBpsLimit,
            DisableUpnp,
            Ipv6PublicAddrProvider,
            Ipv6PublicAddrAuto,
            Ipv6PublicAddrPrefix,
            DisableRelayData,
            EnableUdpBroadcastRelay,
            SocketMark,
            Peers,
            VpnPortalConfig,
            ManagedCredentials,
            PreferPeerRelay,
            DhcpIpv4Cidr,
            Dhcpv6,
            DhcpIpv6Cidr,
            Dns,
            EnableUdpFec,
            EnableUdpFecKcp,
            EnableUdpFecQuic,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "dhcp" => Ok(GeneratedField::Dhcp),
                            "virtualIpv4" | "virtual_ipv4" => Ok(GeneratedField::VirtualIpv4),
                            "networkLength" | "network_length" => Ok(GeneratedField::NetworkLength),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "networkName" | "network_name" => Ok(GeneratedField::NetworkName),
                            "networkSecret" | "network_secret" => Ok(GeneratedField::NetworkSecret),
                            "networkingMethod" | "networking_method" => Ok(GeneratedField::NetworkingMethod),
                            "publicServerUrl" | "public_server_url" => Ok(GeneratedField::PublicServerUrl),
                            "peerUrls" | "peer_urls" => Ok(GeneratedField::PeerUrls),
                            "proxyCidrs" | "proxy_cidrs" => Ok(GeneratedField::ProxyCidrs),
                            "enableVpnPortal" | "enable_vpn_portal" => Ok(GeneratedField::EnableVpnPortal),
                            "vpnPortalListenPort" | "vpn_portal_listen_port" => Ok(GeneratedField::VpnPortalListenPort),
                            "vpnPortalClientNetworkAddr" | "vpn_portal_client_network_addr" => Ok(GeneratedField::VpnPortalClientNetworkAddr),
                            "vpnPortalClientNetworkLen" | "vpn_portal_client_network_len" => Ok(GeneratedField::VpnPortalClientNetworkLen),
                            "advancedSettings" | "advanced_settings" => Ok(GeneratedField::AdvancedSettings),
                            "listenerUrls" | "listener_urls" => Ok(GeneratedField::ListenerUrls),
                            "latencyFirst" | "latency_first" => Ok(GeneratedField::LatencyFirst),
                            "devName" | "dev_name" => Ok(GeneratedField::DevName),
                            "useSmoltcp" | "use_smoltcp" => Ok(GeneratedField::UseSmoltcp),
                            "disableIpv6" | "disable_ipv6" => Ok(GeneratedField::DisableIpv6),
                            "tldDnsZone" | "tld_dns_zone" => Ok(GeneratedField::TldDnsZone),
                            "enableKcpProxy" | "enable_kcp_proxy" => Ok(GeneratedField::EnableKcpProxy),
                            "disableKcpInput" | "disable_kcp_input" => Ok(GeneratedField::DisableKcpInput),
                            "disableP2p" | "disable_p2p" => Ok(GeneratedField::DisableP2p),
                            "bindDevice" | "bind_device" => Ok(GeneratedField::BindDevice),
                            "noTun" | "no_tun" => Ok(GeneratedField::NoTun),
                            "enableExitNode" | "enable_exit_node" => Ok(GeneratedField::EnableExitNode),
                            "relayAllPeerRpc" | "relay_all_peer_rpc" => Ok(GeneratedField::RelayAllPeerRpc),
                            "multiThread" | "multi_thread" => Ok(GeneratedField::MultiThread),
                            "enableRelayNetworkWhitelist" | "enable_relay_network_whitelist" => Ok(GeneratedField::EnableRelayNetworkWhitelist),
                            "relayNetworkWhitelist" | "relay_network_whitelist" => Ok(GeneratedField::RelayNetworkWhitelist),
                            "enableManualRoutes" | "enable_manual_routes" => Ok(GeneratedField::EnableManualRoutes),
                            "routes" => Ok(GeneratedField::Routes),
                            "exitNodes" | "exit_nodes" => Ok(GeneratedField::ExitNodes),
                            "proxyForwardBySystem" | "proxy_forward_by_system" => Ok(GeneratedField::ProxyForwardBySystem),
                            "disableEncryption" | "disable_encryption" => Ok(GeneratedField::DisableEncryption),
                            "enableSocks5" | "enable_socks5" => Ok(GeneratedField::EnableSocks5),
                            "socks5Port" | "socks5_port" => Ok(GeneratedField::Socks5Port),
                            "disableUdpHolePunching" | "disable_udp_hole_punching" => Ok(GeneratedField::DisableUdpHolePunching),
                            "mtu" => Ok(GeneratedField::Mtu),
                            "mappedListeners" | "mapped_listeners" => Ok(GeneratedField::MappedListeners),
                            "enableMagicDns" | "enable_magic_dns" => Ok(GeneratedField::EnableMagicDns),
                            "enablePrivateMode" | "enable_private_mode" => Ok(GeneratedField::EnablePrivateMode),
                            "enableQuicProxy" | "enable_quic_proxy" => Ok(GeneratedField::EnableQuicProxy),
                            "disableQuicInput" | "disable_quic_input" => Ok(GeneratedField::DisableQuicInput),
                            "quicListenPort" | "quic_listen_port" => Ok(GeneratedField::QuicListenPort),
                            "portForwards" | "port_forwards" => Ok(GeneratedField::PortForwards),
                            "disableSymHolePunching" | "disable_sym_hole_punching" => Ok(GeneratedField::DisableSymHolePunching),
                            "p2pOnly" | "p2p_only" => Ok(GeneratedField::P2pOnly),
                            "dataCompressAlgo" | "data_compress_algo" => Ok(GeneratedField::DataCompressAlgo),
                            "encryptionAlgorithm" | "encryption_algorithm" => Ok(GeneratedField::EncryptionAlgorithm),
                            "disableTcpHolePunching" | "disable_tcp_hole_punching" => Ok(GeneratedField::DisableTcpHolePunching),
                            "secureMode" | "secure_mode" => Ok(GeneratedField::SecureMode),
                            "acl" => Ok(GeneratedField::Acl),
                            "credentialFile" | "credential_file" => Ok(GeneratedField::CredentialFile),
                            "lazyP2p" | "lazy_p2p" => Ok(GeneratedField::LazyP2p),
                            "needP2p" | "need_p2p" => Ok(GeneratedField::NeedP2p),
                            "instanceRecvBpsLimit" | "instance_recv_bps_limit" => Ok(GeneratedField::InstanceRecvBpsLimit),
                            "disableUpnp" | "disable_upnp" => Ok(GeneratedField::DisableUpnp),
                            "ipv6PublicAddrProvider" | "ipv6_public_addr_provider" => Ok(GeneratedField::Ipv6PublicAddrProvider),
                            "ipv6PublicAddrAuto" | "ipv6_public_addr_auto" => Ok(GeneratedField::Ipv6PublicAddrAuto),
                            "ipv6PublicAddrPrefix" | "ipv6_public_addr_prefix" => Ok(GeneratedField::Ipv6PublicAddrPrefix),
                            "disableRelayData" | "disable_relay_data" => Ok(GeneratedField::DisableRelayData),
                            "enableUdpBroadcastRelay" | "enable_udp_broadcast_relay" => Ok(GeneratedField::EnableUdpBroadcastRelay),
                            "socketMark" | "socket_mark" => Ok(GeneratedField::SocketMark),
                            "peers" => Ok(GeneratedField::Peers),
                            "vpnPortalConfig" | "vpn_portal_config" => Ok(GeneratedField::VpnPortalConfig),
                            "managedCredentials" | "managed_credentials" => Ok(GeneratedField::ManagedCredentials),
                            "preferPeerRelay" | "prefer_peer_relay" => Ok(GeneratedField::PreferPeerRelay),
                            "dhcpIpv4Cidr" | "dhcp_ipv4_cidr" => Ok(GeneratedField::DhcpIpv4Cidr),
                            "dhcpv6" => Ok(GeneratedField::Dhcpv6),
                            "dhcpIpv6Cidr" | "dhcp_ipv6_cidr" => Ok(GeneratedField::DhcpIpv6Cidr),
                            "dns" => Ok(GeneratedField::Dns),
                            "enableUdpFec" | "enable_udp_fec" => Ok(GeneratedField::EnableUdpFec),
                            "enableUdpFecKcp" | "enable_udp_fec_kcp" => Ok(GeneratedField::EnableUdpFecKcp),
                            "enableUdpFecQuic" | "enable_udp_fec_quic" => Ok(GeneratedField::EnableUdpFecQuic),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NetworkConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.NetworkConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NetworkConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance_id__ = None;
                let mut dhcp__ = None;
                let mut virtual_ipv4__ = None;
                let mut network_length__ = None;
                let mut hostname__ = None;
                let mut network_name__ = None;
                let mut network_secret__ = None;
                let mut networking_method__ = None;
                let mut public_server_url__ = None;
                let mut peer_urls__ = None;
                let mut proxy_cidrs__ = None;
                let mut enable_vpn_portal__ = None;
                let mut vpn_portal_listen_port__ = None;
                let mut vpn_portal_client_network_addr__ = None;
                let mut vpn_portal_client_network_len__ = None;
                let mut advanced_settings__ = None;
                let mut listener_urls__ = None;
                let mut latency_first__ = None;
                let mut dev_name__ = None;
                let mut use_smoltcp__ = None;
                let mut disable_ipv6__ = None;
                let mut tld_dns_zone__ = None;
                let mut enable_kcp_proxy__ = None;
                let mut disable_kcp_input__ = None;
                let mut disable_p2p__ = None;
                let mut bind_device__ = None;
                let mut no_tun__ = None;
                let mut enable_exit_node__ = None;
                let mut relay_all_peer_rpc__ = None;
                let mut multi_thread__ = None;
                let mut enable_relay_network_whitelist__ = None;
                let mut relay_network_whitelist__ = None;
                let mut enable_manual_routes__ = None;
                let mut routes__ = None;
                let mut exit_nodes__ = None;
                let mut proxy_forward_by_system__ = None;
                let mut disable_encryption__ = None;
                let mut enable_socks5__ = None;
                let mut socks5_port__ = None;
                let mut disable_udp_hole_punching__ = None;
                let mut mtu__ = None;
                let mut mapped_listeners__ = None;
                let mut enable_magic_dns__ = None;
                let mut enable_private_mode__ = None;
                let mut enable_quic_proxy__ = None;
                let mut disable_quic_input__ = None;
                let mut quic_listen_port__ = None;
                let mut port_forwards__ = None;
                let mut disable_sym_hole_punching__ = None;
                let mut p2p_only__ = None;
                let mut data_compress_algo__ = None;
                let mut encryption_algorithm__ = None;
                let mut disable_tcp_hole_punching__ = None;
                let mut secure_mode__ = None;
                let mut acl__ = None;
                let mut credential_file__ = None;
                let mut lazy_p2p__ = None;
                let mut need_p2p__ = None;
                let mut instance_recv_bps_limit__ = None;
                let mut disable_upnp__ = None;
                let mut ipv6_public_addr_provider__ = None;
                let mut ipv6_public_addr_auto__ = None;
                let mut ipv6_public_addr_prefix__ = None;
                let mut disable_relay_data__ = None;
                let mut enable_udp_broadcast_relay__ = None;
                let mut socket_mark__ = None;
                let mut peers__ = None;
                let mut vpn_portal_config__ = None;
                let mut managed_credentials__ = None;
                let mut prefer_peer_relay__ = None;
                let mut dhcp_ipv4_cidr__ = None;
                let mut dhcpv6__ = None;
                let mut dhcp_ipv6_cidr__ = None;
                let mut dns__ = None;
                let mut enable_udp_fec__ = None;
                let mut enable_udp_fec_kcp__ = None;
                let mut enable_udp_fec_quic__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = map_.next_value()?;
                        }
                        GeneratedField::Dhcp => {
                            if dhcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dhcp"));
                            }
                            dhcp__ = map_.next_value()?;
                        }
                        GeneratedField::VirtualIpv4 => {
                            if virtual_ipv4__.is_some() {
                                return Err(serde::de::Error::duplicate_field("virtualIpv4"));
                            }
                            virtual_ipv4__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkLength => {
                            if network_length__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkLength"));
                            }
                            network_length__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Hostname => {
                            if hostname__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hostname"));
                            }
                            hostname__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkName => {
                            if network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkName"));
                            }
                            network_name__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkSecret => {
                            if network_secret__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkSecret"));
                            }
                            network_secret__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkingMethod => {
                            if networking_method__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkingMethod"));
                            }
                            networking_method__ = map_.next_value::<::std::option::Option<NetworkingMethod>>()?.map(|x| x as i32);
                        }
                        GeneratedField::PublicServerUrl => {
                            if public_server_url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicServerUrl"));
                            }
                            public_server_url__ = map_.next_value()?;
                        }
                        GeneratedField::PeerUrls => {
                            if peer_urls__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerUrls"));
                            }
                            peer_urls__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ProxyCidrs => {
                            if proxy_cidrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyCidrs"));
                            }
                            proxy_cidrs__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableVpnPortal => {
                            if enable_vpn_portal__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableVpnPortal"));
                            }
                            enable_vpn_portal__ = map_.next_value()?;
                        }
                        GeneratedField::VpnPortalListenPort => {
                            if vpn_portal_listen_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalListenPort"));
                            }
                            vpn_portal_listen_port__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::VpnPortalClientNetworkAddr => {
                            if vpn_portal_client_network_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalClientNetworkAddr"));
                            }
                            vpn_portal_client_network_addr__ = map_.next_value()?;
                        }
                        GeneratedField::VpnPortalClientNetworkLen => {
                            if vpn_portal_client_network_len__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalClientNetworkLen"));
                            }
                            vpn_portal_client_network_len__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::AdvancedSettings => {
                            if advanced_settings__.is_some() {
                                return Err(serde::de::Error::duplicate_field("advancedSettings"));
                            }
                            advanced_settings__ = map_.next_value()?;
                        }
                        GeneratedField::ListenerUrls => {
                            if listener_urls__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerUrls"));
                            }
                            listener_urls__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LatencyFirst => {
                            if latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("latencyFirst"));
                            }
                            latency_first__ = map_.next_value()?;
                        }
                        GeneratedField::DevName => {
                            if dev_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("devName"));
                            }
                            dev_name__ = map_.next_value()?;
                        }
                        GeneratedField::UseSmoltcp => {
                            if use_smoltcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("useSmoltcp"));
                            }
                            use_smoltcp__ = map_.next_value()?;
                        }
                        GeneratedField::DisableIpv6 => {
                            if disable_ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableIpv6"));
                            }
                            disable_ipv6__ = map_.next_value()?;
                        }
                        GeneratedField::TldDnsZone => {
                            if tld_dns_zone__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tldDnsZone"));
                            }
                            tld_dns_zone__ = map_.next_value()?;
                        }
                        GeneratedField::EnableKcpProxy => {
                            if enable_kcp_proxy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableKcpProxy"));
                            }
                            enable_kcp_proxy__ = map_.next_value()?;
                        }
                        GeneratedField::DisableKcpInput => {
                            if disable_kcp_input__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableKcpInput"));
                            }
                            disable_kcp_input__ = map_.next_value()?;
                        }
                        GeneratedField::DisableP2p => {
                            if disable_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableP2p"));
                            }
                            disable_p2p__ = map_.next_value()?;
                        }
                        GeneratedField::BindDevice => {
                            if bind_device__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bindDevice"));
                            }
                            bind_device__ = map_.next_value()?;
                        }
                        GeneratedField::NoTun => {
                            if no_tun__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noTun"));
                            }
                            no_tun__ = map_.next_value()?;
                        }
                        GeneratedField::EnableExitNode => {
                            if enable_exit_node__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableExitNode"));
                            }
                            enable_exit_node__ = map_.next_value()?;
                        }
                        GeneratedField::RelayAllPeerRpc => {
                            if relay_all_peer_rpc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayAllPeerRpc"));
                            }
                            relay_all_peer_rpc__ = map_.next_value()?;
                        }
                        GeneratedField::MultiThread => {
                            if multi_thread__.is_some() {
                                return Err(serde::de::Error::duplicate_field("multiThread"));
                            }
                            multi_thread__ = map_.next_value()?;
                        }
                        GeneratedField::EnableRelayNetworkWhitelist => {
                            if enable_relay_network_whitelist__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableRelayNetworkWhitelist"));
                            }
                            enable_relay_network_whitelist__ = map_.next_value()?;
                        }
                        GeneratedField::RelayNetworkWhitelist => {
                            if relay_network_whitelist__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayNetworkWhitelist"));
                            }
                            relay_network_whitelist__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableManualRoutes => {
                            if enable_manual_routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableManualRoutes"));
                            }
                            enable_manual_routes__ = map_.next_value()?;
                        }
                        GeneratedField::Routes => {
                            if routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("routes"));
                            }
                            routes__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ExitNodes => {
                            if exit_nodes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("exitNodes"));
                            }
                            exit_nodes__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ProxyForwardBySystem => {
                            if proxy_forward_by_system__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyForwardBySystem"));
                            }
                            proxy_forward_by_system__ = map_.next_value()?;
                        }
                        GeneratedField::DisableEncryption => {
                            if disable_encryption__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableEncryption"));
                            }
                            disable_encryption__ = map_.next_value()?;
                        }
                        GeneratedField::EnableSocks5 => {
                            if enable_socks5__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableSocks5"));
                            }
                            enable_socks5__ = map_.next_value()?;
                        }
                        GeneratedField::Socks5Port => {
                            if socks5_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("socks5Port"));
                            }
                            socks5_port__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::DisableUdpHolePunching => {
                            if disable_udp_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableUdpHolePunching"));
                            }
                            disable_udp_hole_punching__ = map_.next_value()?;
                        }
                        GeneratedField::Mtu => {
                            if mtu__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mtu"));
                            }
                            mtu__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::MappedListeners => {
                            if mapped_listeners__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mappedListeners"));
                            }
                            mapped_listeners__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableMagicDns => {
                            if enable_magic_dns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableMagicDns"));
                            }
                            enable_magic_dns__ = map_.next_value()?;
                        }
                        GeneratedField::EnablePrivateMode => {
                            if enable_private_mode__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enablePrivateMode"));
                            }
                            enable_private_mode__ = map_.next_value()?;
                        }
                        GeneratedField::EnableQuicProxy => {
                            if enable_quic_proxy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableQuicProxy"));
                            }
                            enable_quic_proxy__ = map_.next_value()?;
                        }
                        GeneratedField::DisableQuicInput => {
                            if disable_quic_input__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableQuicInput"));
                            }
                            disable_quic_input__ = map_.next_value()?;
                        }
                        GeneratedField::QuicListenPort => {
                            if quic_listen_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("quicListenPort"));
                            }
                            quic_listen_port__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::PortForwards => {
                            if port_forwards__.is_some() {
                                return Err(serde::de::Error::duplicate_field("portForwards"));
                            }
                            port_forwards__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableSymHolePunching => {
                            if disable_sym_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableSymHolePunching"));
                            }
                            disable_sym_hole_punching__ = map_.next_value()?;
                        }
                        GeneratedField::P2pOnly => {
                            if p2p_only__.is_some() {
                                return Err(serde::de::Error::duplicate_field("p2pOnly"));
                            }
                            p2p_only__ = map_.next_value()?;
                        }
                        GeneratedField::DataCompressAlgo => {
                            if data_compress_algo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dataCompressAlgo"));
                            }
                            data_compress_algo__ = map_.next_value::<::std::option::Option<super::super::common::CompressionAlgoPb>>()?.map(|x| x as i32);
                        }
                        GeneratedField::EncryptionAlgorithm => {
                            if encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("encryptionAlgorithm"));
                            }
                            encryption_algorithm__ = map_.next_value()?;
                        }
                        GeneratedField::DisableTcpHolePunching => {
                            if disable_tcp_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableTcpHolePunching"));
                            }
                            disable_tcp_hole_punching__ = map_.next_value()?;
                        }
                        GeneratedField::SecureMode => {
                            if secure_mode__.is_some() {
                                return Err(serde::de::Error::duplicate_field("secureMode"));
                            }
                            secure_mode__ = map_.next_value()?;
                        }
                        GeneratedField::Acl => {
                            if acl__.is_some() {
                                return Err(serde::de::Error::duplicate_field("acl"));
                            }
                            acl__ = map_.next_value()?;
                        }
                        GeneratedField::CredentialFile => {
                            if credential_file__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialFile"));
                            }
                            credential_file__ = map_.next_value()?;
                        }
                        GeneratedField::LazyP2p => {
                            if lazy_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lazyP2p"));
                            }
                            lazy_p2p__ = map_.next_value()?;
                        }
                        GeneratedField::NeedP2p => {
                            if need_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("needP2p"));
                            }
                            need_p2p__ = map_.next_value()?;
                        }
                        GeneratedField::InstanceRecvBpsLimit => {
                            if instance_recv_bps_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceRecvBpsLimit"));
                            }
                            instance_recv_bps_limit__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::DisableUpnp => {
                            if disable_upnp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableUpnp"));
                            }
                            disable_upnp__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6PublicAddrProvider => {
                            if ipv6_public_addr_provider__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrProvider"));
                            }
                            ipv6_public_addr_provider__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6PublicAddrAuto => {
                            if ipv6_public_addr_auto__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrAuto"));
                            }
                            ipv6_public_addr_auto__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6PublicAddrPrefix => {
                            if ipv6_public_addr_prefix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrPrefix"));
                            }
                            ipv6_public_addr_prefix__ = map_.next_value()?;
                        }
                        GeneratedField::DisableRelayData => {
                            if disable_relay_data__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableRelayData"));
                            }
                            disable_relay_data__ = map_.next_value()?;
                        }
                        GeneratedField::EnableUdpBroadcastRelay => {
                            if enable_udp_broadcast_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpBroadcastRelay"));
                            }
                            enable_udp_broadcast_relay__ = map_.next_value()?;
                        }
                        GeneratedField::SocketMark => {
                            if socket_mark__.is_some() {
                                return Err(serde::de::Error::duplicate_field("socketMark"));
                            }
                            socket_mark__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Peers => {
                            if peers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peers"));
                            }
                            peers__ = Some(map_.next_value()?);
                        }
                        GeneratedField::VpnPortalConfig => {
                            if vpn_portal_config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalConfig"));
                            }
                            vpn_portal_config__ = map_.next_value()?;
                        }
                        GeneratedField::ManagedCredentials => {
                            if managed_credentials__.is_some() {
                                return Err(serde::de::Error::duplicate_field("managedCredentials"));
                            }
                            managed_credentials__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PreferPeerRelay => {
                            if prefer_peer_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preferPeerRelay"));
                            }
                            prefer_peer_relay__ = map_.next_value()?;
                        }
                        GeneratedField::DhcpIpv4Cidr => {
                            if dhcp_ipv4_cidr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dhcpIpv4Cidr"));
                            }
                            dhcp_ipv4_cidr__ = map_.next_value()?;
                        }
                        GeneratedField::Dhcpv6 => {
                            if dhcpv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dhcpv6"));
                            }
                            dhcpv6__ = map_.next_value()?;
                        }
                        GeneratedField::DhcpIpv6Cidr => {
                            if dhcp_ipv6_cidr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dhcpIpv6Cidr"));
                            }
                            dhcp_ipv6_cidr__ = map_.next_value()?;
                        }
                        GeneratedField::Dns => {
                            if dns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dns"));
                            }
                            dns__ = map_.next_value()?;
                        }
                        GeneratedField::EnableUdpFec => {
                            if enable_udp_fec__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpFec"));
                            }
                            enable_udp_fec__ = map_.next_value()?;
                        }
                        GeneratedField::EnableUdpFecKcp => {
                            if enable_udp_fec_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpFecKcp"));
                            }
                            enable_udp_fec_kcp__ = map_.next_value()?;
                        }
                        GeneratedField::EnableUdpFecQuic => {
                            if enable_udp_fec_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpFecQuic"));
                            }
                            enable_udp_fec_quic__ = map_.next_value()?;
                        }
                    }
                }
                Ok(NetworkConfig {
                    instance_id: instance_id__,
                    dhcp: dhcp__,
                    virtual_ipv4: virtual_ipv4__,
                    network_length: network_length__,
                    hostname: hostname__,
                    network_name: network_name__,
                    network_secret: network_secret__,
                    networking_method: networking_method__,
                    public_server_url: public_server_url__,
                    peer_urls: peer_urls__.unwrap_or_default(),
                    proxy_cidrs: proxy_cidrs__.unwrap_or_default(),
                    enable_vpn_portal: enable_vpn_portal__,
                    vpn_portal_listen_port: vpn_portal_listen_port__,
                    vpn_portal_client_network_addr: vpn_portal_client_network_addr__,
                    vpn_portal_client_network_len: vpn_portal_client_network_len__,
                    advanced_settings: advanced_settings__,
                    listener_urls: listener_urls__.unwrap_or_default(),
                    latency_first: latency_first__,
                    dev_name: dev_name__,
                    use_smoltcp: use_smoltcp__,
                    disable_ipv6: disable_ipv6__,
                    tld_dns_zone: tld_dns_zone__,
                    enable_kcp_proxy: enable_kcp_proxy__,
                    disable_kcp_input: disable_kcp_input__,
                    disable_p2p: disable_p2p__,
                    bind_device: bind_device__,
                    no_tun: no_tun__,
                    enable_exit_node: enable_exit_node__,
                    relay_all_peer_rpc: relay_all_peer_rpc__,
                    multi_thread: multi_thread__,
                    enable_relay_network_whitelist: enable_relay_network_whitelist__,
                    relay_network_whitelist: relay_network_whitelist__.unwrap_or_default(),
                    enable_manual_routes: enable_manual_routes__,
                    routes: routes__.unwrap_or_default(),
                    exit_nodes: exit_nodes__.unwrap_or_default(),
                    proxy_forward_by_system: proxy_forward_by_system__,
                    disable_encryption: disable_encryption__,
                    enable_socks5: enable_socks5__,
                    socks5_port: socks5_port__,
                    disable_udp_hole_punching: disable_udp_hole_punching__,
                    mtu: mtu__,
                    mapped_listeners: mapped_listeners__.unwrap_or_default(),
                    enable_magic_dns: enable_magic_dns__,
                    enable_private_mode: enable_private_mode__,
                    enable_quic_proxy: enable_quic_proxy__,
                    disable_quic_input: disable_quic_input__,
                    quic_listen_port: quic_listen_port__,
                    port_forwards: port_forwards__.unwrap_or_default(),
                    disable_sym_hole_punching: disable_sym_hole_punching__,
                    p2p_only: p2p_only__,
                    data_compress_algo: data_compress_algo__,
                    encryption_algorithm: encryption_algorithm__,
                    disable_tcp_hole_punching: disable_tcp_hole_punching__,
                    secure_mode: secure_mode__,
                    acl: acl__,
                    credential_file: credential_file__,
                    lazy_p2p: lazy_p2p__,
                    need_p2p: need_p2p__,
                    instance_recv_bps_limit: instance_recv_bps_limit__,
                    disable_upnp: disable_upnp__,
                    ipv6_public_addr_provider: ipv6_public_addr_provider__,
                    ipv6_public_addr_auto: ipv6_public_addr_auto__,
                    ipv6_public_addr_prefix: ipv6_public_addr_prefix__,
                    disable_relay_data: disable_relay_data__,
                    enable_udp_broadcast_relay: enable_udp_broadcast_relay__,
                    socket_mark: socket_mark__,
                    peers: peers__.unwrap_or_default(),
                    vpn_portal_config: vpn_portal_config__,
                    managed_credentials: managed_credentials__.unwrap_or_default(),
                    prefer_peer_relay: prefer_peer_relay__,
                    dhcp_ipv4_cidr: dhcp_ipv4_cidr__,
                    dhcpv6: dhcpv6__,
                    dhcp_ipv6_cidr: dhcp_ipv6_cidr__,
                    dns: dns__,
                    enable_udp_fec: enable_udp_fec__,
                    enable_udp_fec_kcp: enable_udp_fec_kcp__,
                    enable_udp_fec_quic: enable_udp_fec_quic__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.NetworkConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NetworkInstanceRunningInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.dev_name.is_empty() {
            len += 1;
        }
        if self.my_node_info.is_some() {
            len += 1;
        }
        if !self.events.is_empty() {
            len += 1;
        }
        if !self.routes.is_empty() {
            len += 1;
        }
        if !self.peers.is_empty() {
            len += 1;
        }
        if !self.peer_route_pairs.is_empty() {
            len += 1;
        }
        if self.running {
            len += 1;
        }
        if self.error_msg.is_some() {
            len += 1;
        }
        if self.foreign_network_summary.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.NetworkInstanceRunningInfo", len)?;
        if !self.dev_name.is_empty() {
            struct_ser.serialize_field("dev_name", &self.dev_name)?;
        }
        if let Some(v) = self.my_node_info.as_ref() {
            struct_ser.serialize_field("my_node_info", v)?;
        }
        if !self.events.is_empty() {
            struct_ser.serialize_field("events", &self.events)?;
        }
        if !self.routes.is_empty() {
            struct_ser.serialize_field("routes", &self.routes)?;
        }
        if !self.peers.is_empty() {
            struct_ser.serialize_field("peers", &self.peers)?;
        }
        if !self.peer_route_pairs.is_empty() {
            struct_ser.serialize_field("peer_route_pairs", &self.peer_route_pairs)?;
        }
        if self.running {
            struct_ser.serialize_field("running", &self.running)?;
        }
        if let Some(v) = self.error_msg.as_ref() {
            struct_ser.serialize_field("error_msg", v)?;
        }
        if let Some(v) = self.foreign_network_summary.as_ref() {
            struct_ser.serialize_field("foreign_network_summary", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NetworkInstanceRunningInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "dev_name",
            "devName",
            "my_node_info",
            "myNodeInfo",
            "events",
            "routes",
            "peers",
            "peer_route_pairs",
            "peerRoutePairs",
            "running",
            "error_msg",
            "errorMsg",
            "foreign_network_summary",
            "foreignNetworkSummary",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DevName,
            MyNodeInfo,
            Events,
            Routes,
            Peers,
            PeerRoutePairs,
            Running,
            ErrorMsg,
            ForeignNetworkSummary,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "devName" | "dev_name" => Ok(GeneratedField::DevName),
                            "myNodeInfo" | "my_node_info" => Ok(GeneratedField::MyNodeInfo),
                            "events" => Ok(GeneratedField::Events),
                            "routes" => Ok(GeneratedField::Routes),
                            "peers" => Ok(GeneratedField::Peers),
                            "peerRoutePairs" | "peer_route_pairs" => Ok(GeneratedField::PeerRoutePairs),
                            "running" => Ok(GeneratedField::Running),
                            "errorMsg" | "error_msg" => Ok(GeneratedField::ErrorMsg),
                            "foreignNetworkSummary" | "foreign_network_summary" => Ok(GeneratedField::ForeignNetworkSummary),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NetworkInstanceRunningInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.NetworkInstanceRunningInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NetworkInstanceRunningInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut dev_name__ = None;
                let mut my_node_info__ = None;
                let mut events__ = None;
                let mut routes__ = None;
                let mut peers__ = None;
                let mut peer_route_pairs__ = None;
                let mut running__ = None;
                let mut error_msg__ = None;
                let mut foreign_network_summary__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DevName => {
                            if dev_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("devName"));
                            }
                            dev_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MyNodeInfo => {
                            if my_node_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myNodeInfo"));
                            }
                            my_node_info__ = map_.next_value()?;
                        }
                        GeneratedField::Events => {
                            if events__.is_some() {
                                return Err(serde::de::Error::duplicate_field("events"));
                            }
                            events__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Routes => {
                            if routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("routes"));
                            }
                            routes__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Peers => {
                            if peers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peers"));
                            }
                            peers__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PeerRoutePairs => {
                            if peer_route_pairs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerRoutePairs"));
                            }
                            peer_route_pairs__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Running => {
                            if running__.is_some() {
                                return Err(serde::de::Error::duplicate_field("running"));
                            }
                            running__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ErrorMsg => {
                            if error_msg__.is_some() {
                                return Err(serde::de::Error::duplicate_field("errorMsg"));
                            }
                            error_msg__ = map_.next_value()?;
                        }
                        GeneratedField::ForeignNetworkSummary => {
                            if foreign_network_summary__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignNetworkSummary"));
                            }
                            foreign_network_summary__ = map_.next_value()?;
                        }
                    }
                }
                Ok(NetworkInstanceRunningInfo {
                    dev_name: dev_name__.unwrap_or_default(),
                    my_node_info: my_node_info__,
                    events: events__.unwrap_or_default(),
                    routes: routes__.unwrap_or_default(),
                    peers: peers__.unwrap_or_default(),
                    peer_route_pairs: peer_route_pairs__.unwrap_or_default(),
                    running: running__.unwrap_or_default(),
                    error_msg: error_msg__,
                    foreign_network_summary: foreign_network_summary__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.NetworkInstanceRunningInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NetworkInstanceRunningInfoMap {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.map.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.NetworkInstanceRunningInfoMap", len)?;
        if !self.map.is_empty() {
            struct_ser.serialize_field("map", &self.map)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NetworkInstanceRunningInfoMap {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "map",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Map,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "map" => Ok(GeneratedField::Map),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NetworkInstanceRunningInfoMap;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.NetworkInstanceRunningInfoMap")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NetworkInstanceRunningInfoMap, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut map__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Map => {
                            if map__.is_some() {
                                return Err(serde::de::Error::duplicate_field("map"));
                            }
                            map__ = Some(
                                map_.next_value::<std::collections::BTreeMap<_, _>>()?
                            );
                        }
                    }
                }
                Ok(NetworkInstanceRunningInfoMap {
                    map: map__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.NetworkInstanceRunningInfoMap", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NetworkMeta {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.inst_id.is_some() {
            len += 1;
        }
        if !self.network_name.is_empty() {
            len += 1;
        }
        if self.config_permission != 0 {
            len += 1;
        }
        if !self.instance_name.is_empty() {
            len += 1;
        }
        if self.source != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.NetworkMeta", len)?;
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        if !self.network_name.is_empty() {
            struct_ser.serialize_field("network_name", &self.network_name)?;
        }
        if self.config_permission != 0 {
            struct_ser.serialize_field("config_permission", &self.config_permission)?;
        }
        if !self.instance_name.is_empty() {
            struct_ser.serialize_field("instance_name", &self.instance_name)?;
        }
        if self.source != 0 {
            let v = ConfigSource::try_from(self.source)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.source)))?;
            struct_ser.serialize_field("source", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NetworkMeta {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_id",
            "instId",
            "network_name",
            "networkName",
            "config_permission",
            "configPermission",
            "instance_name",
            "instanceName",
            "source",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstId,
            NetworkName,
            ConfigPermission,
            InstanceName,
            Source,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "networkName" | "network_name" => Ok(GeneratedField::NetworkName),
                            "configPermission" | "config_permission" => Ok(GeneratedField::ConfigPermission),
                            "instanceName" | "instance_name" => Ok(GeneratedField::InstanceName),
                            "source" => Ok(GeneratedField::Source),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NetworkMeta;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.NetworkMeta")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NetworkMeta, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_id__ = None;
                let mut network_name__ = None;
                let mut config_permission__ = None;
                let mut instance_name__ = None;
                let mut source__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkName => {
                            if network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkName"));
                            }
                            network_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ConfigPermission => {
                            if config_permission__.is_some() {
                                return Err(serde::de::Error::duplicate_field("configPermission"));
                            }
                            config_permission__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::InstanceName => {
                            if instance_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceName"));
                            }
                            instance_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value::<ConfigSource>()? as i32);
                        }
                    }
                }
                Ok(NetworkMeta {
                    inst_id: inst_id__,
                    network_name: network_name__.unwrap_or_default(),
                    config_permission: config_permission__.unwrap_or_default(),
                    instance_name: instance_name__.unwrap_or_default(),
                    source: source__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.NetworkMeta", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NetworkPeerConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.uri.is_empty() {
            len += 1;
        }
        if self.peer_public_key.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.NetworkPeerConfig", len)?;
        if !self.uri.is_empty() {
            struct_ser.serialize_field("uri", &self.uri)?;
        }
        if let Some(v) = self.peer_public_key.as_ref() {
            struct_ser.serialize_field("peer_public_key", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NetworkPeerConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "uri",
            "peer_public_key",
            "peerPublicKey",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Uri,
            PeerPublicKey,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "uri" => Ok(GeneratedField::Uri),
                            "peerPublicKey" | "peer_public_key" => Ok(GeneratedField::PeerPublicKey),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NetworkPeerConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.NetworkPeerConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NetworkPeerConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut uri__ = None;
                let mut peer_public_key__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Uri => {
                            if uri__.is_some() {
                                return Err(serde::de::Error::duplicate_field("uri"));
                            }
                            uri__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PeerPublicKey => {
                            if peer_public_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerPublicKey"));
                            }
                            peer_public_key__ = map_.next_value()?;
                        }
                    }
                }
                Ok(NetworkPeerConfig {
                    uri: uri__.unwrap_or_default(),
                    peer_public_key: peer_public_key__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.NetworkPeerConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NetworkingMethod {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::PublicServer => "PublicServer",
            Self::Manual => "Manual",
            Self::Standalone => "Standalone",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for NetworkingMethod {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "PublicServer",
            "Manual",
            "Standalone",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = NetworkingMethod;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(formatter, "expected one of: {:?}", &FIELDS)
            }

            fn visit_i64<E>(self, v: i64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Signed(v), &self)
                    })
            }

            fn visit_u64<E>(self, v: u64) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                i32::try_from(v)
                    .ok()
                    .and_then(|x| x.try_into().ok())
                    .ok_or_else(|| {
                        serde::de::Error::invalid_value(serde::de::Unexpected::Unsigned(v), &self)
                    })
            }

            fn visit_str<E>(self, value: &str) -> std::result::Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match value {
                    "PublicServer" => Ok(NetworkingMethod::PublicServer),
                    "Manual" => Ok(NetworkingMethod::Manual),
                    "Standalone" => Ok(NetworkingMethod::Standalone),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for PortForwardConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.bind_ip.is_empty() {
            len += 1;
        }
        if self.bind_port != 0 {
            len += 1;
        }
        if !self.dst_ip.is_empty() {
            len += 1;
        }
        if self.dst_port != 0 {
            len += 1;
        }
        if !self.proto.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.PortForwardConfig", len)?;
        if !self.bind_ip.is_empty() {
            struct_ser.serialize_field("bind_ip", &self.bind_ip)?;
        }
        if self.bind_port != 0 {
            struct_ser.serialize_field("bind_port", &self.bind_port)?;
        }
        if !self.dst_ip.is_empty() {
            struct_ser.serialize_field("dst_ip", &self.dst_ip)?;
        }
        if self.dst_port != 0 {
            struct_ser.serialize_field("dst_port", &self.dst_port)?;
        }
        if !self.proto.is_empty() {
            struct_ser.serialize_field("proto", &self.proto)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PortForwardConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "bind_ip",
            "bindIp",
            "bind_port",
            "bindPort",
            "dst_ip",
            "dstIp",
            "dst_port",
            "dstPort",
            "proto",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            BindIp,
            BindPort,
            DstIp,
            DstPort,
            Proto,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "bindIp" | "bind_ip" => Ok(GeneratedField::BindIp),
                            "bindPort" | "bind_port" => Ok(GeneratedField::BindPort),
                            "dstIp" | "dst_ip" => Ok(GeneratedField::DstIp),
                            "dstPort" | "dst_port" => Ok(GeneratedField::DstPort),
                            "proto" => Ok(GeneratedField::Proto),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PortForwardConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.PortForwardConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PortForwardConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut bind_ip__ = None;
                let mut bind_port__ = None;
                let mut dst_ip__ = None;
                let mut dst_port__ = None;
                let mut proto__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::BindIp => {
                            if bind_ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bindIp"));
                            }
                            bind_ip__ = Some(map_.next_value()?);
                        }
                        GeneratedField::BindPort => {
                            if bind_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bindPort"));
                            }
                            bind_port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::DstIp => {
                            if dst_ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dstIp"));
                            }
                            dst_ip__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DstPort => {
                            if dst_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dstPort"));
                            }
                            dst_port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Proto => {
                            if proto__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proto"));
                            }
                            proto__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(PortForwardConfig {
                    bind_ip: bind_ip__.unwrap_or_default(),
                    bind_port: bind_port__.unwrap_or_default(),
                    dst_ip: dst_ip__.unwrap_or_default(),
                    dst_port: dst_port__.unwrap_or_default(),
                    proto: proto__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.PortForwardConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RetainNetworkInstanceRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.RetainNetworkInstanceRequest", len)?;
        if !self.inst_ids.is_empty() {
            struct_ser.serialize_field("inst_ids", &self.inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RetainNetworkInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_ids",
            "instIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instIds" | "inst_ids" => Ok(GeneratedField::InstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RetainNetworkInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.RetainNetworkInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RetainNetworkInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstIds => {
                            if inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instIds"));
                            }
                            inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RetainNetworkInstanceRequest {
                    inst_ids: inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.RetainNetworkInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RetainNetworkInstanceResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.remain_inst_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.RetainNetworkInstanceResponse", len)?;
        if !self.remain_inst_ids.is_empty() {
            struct_ser.serialize_field("remain_inst_ids", &self.remain_inst_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RetainNetworkInstanceResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "remain_inst_ids",
            "remainInstIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            RemainInstIds,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "remainInstIds" | "remain_inst_ids" => Ok(GeneratedField::RemainInstIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RetainNetworkInstanceResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.RetainNetworkInstanceResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RetainNetworkInstanceResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut remain_inst_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::RemainInstIds => {
                            if remain_inst_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("remainInstIds"));
                            }
                            remain_inst_ids__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RetainNetworkInstanceResponse {
                    remain_inst_ids: remain_inst_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.RetainNetworkInstanceResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RunNetworkInstanceRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.inst_id.is_some() {
            len += 1;
        }
        if self.config.is_some() {
            len += 1;
        }
        if self.overwrite {
            len += 1;
        }
        if self.source != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.RunNetworkInstanceRequest", len)?;
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        if let Some(v) = self.config.as_ref() {
            struct_ser.serialize_field("config", v)?;
        }
        if self.overwrite {
            struct_ser.serialize_field("overwrite", &self.overwrite)?;
        }
        if self.source != 0 {
            let v = ConfigSource::try_from(self.source)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.source)))?;
            struct_ser.serialize_field("source", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RunNetworkInstanceRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_id",
            "instId",
            "config",
            "overwrite",
            "source",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstId,
            Config,
            Overwrite,
            Source,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "config" => Ok(GeneratedField::Config),
                            "overwrite" => Ok(GeneratedField::Overwrite),
                            "source" => Ok(GeneratedField::Source),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RunNetworkInstanceRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.RunNetworkInstanceRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RunNetworkInstanceRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_id__ = None;
                let mut config__ = None;
                let mut overwrite__ = None;
                let mut source__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = map_.next_value()?;
                        }
                        GeneratedField::Config => {
                            if config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("config"));
                            }
                            config__ = map_.next_value()?;
                        }
                        GeneratedField::Overwrite => {
                            if overwrite__.is_some() {
                                return Err(serde::de::Error::duplicate_field("overwrite"));
                            }
                            overwrite__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value::<ConfigSource>()? as i32);
                        }
                    }
                }
                Ok(RunNetworkInstanceRequest {
                    inst_id: inst_id__,
                    config: config__,
                    overwrite: overwrite__.unwrap_or_default(),
                    source: source__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.RunNetworkInstanceRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RunNetworkInstanceResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.inst_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.RunNetworkInstanceResponse", len)?;
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RunNetworkInstanceResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "inst_id",
            "instId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InstId,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RunNetworkInstanceResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.RunNetworkInstanceResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RunNetworkInstanceResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut inst_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RunNetworkInstanceResponse {
                    inst_id: inst_id__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.RunNetworkInstanceResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ValidateConfigRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.config.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ValidateConfigRequest", len)?;
        if let Some(v) = self.config.as_ref() {
            struct_ser.serialize_field("config", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ValidateConfigRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "config",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Config,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "config" => Ok(GeneratedField::Config),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ValidateConfigRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ValidateConfigRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ValidateConfigRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut config__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Config => {
                            if config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("config"));
                            }
                            config__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ValidateConfigRequest {
                    config: config__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ValidateConfigRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ValidateConfigResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.toml_config.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.ValidateConfigResponse", len)?;
        if !self.toml_config.is_empty() {
            struct_ser.serialize_field("toml_config", &self.toml_config)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ValidateConfigResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "toml_config",
            "tomlConfig",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            TomlConfig,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "tomlConfig" | "toml_config" => Ok(GeneratedField::TomlConfig),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ValidateConfigResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.ValidateConfigResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ValidateConfigResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut toml_config__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::TomlConfig => {
                            if toml_config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tomlConfig"));
                            }
                            toml_config__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ValidateConfigResponse {
                    toml_config: toml_config__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.ValidateConfigResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for VpnPortalClientConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.name.is_empty() {
            len += 1;
        }
        if !self.virtual_ip.is_empty() {
            len += 1;
        }
        if !self.groups.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.VpnPortalClientConfig", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.virtual_ip.is_empty() {
            struct_ser.serialize_field("virtual_ip", &self.virtual_ip)?;
        }
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for VpnPortalClientConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "virtual_ip",
            "virtualIp",
            "groups",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            VirtualIp,
            Groups,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "name" => Ok(GeneratedField::Name),
                            "virtualIp" | "virtual_ip" => Ok(GeneratedField::VirtualIp),
                            "groups" => Ok(GeneratedField::Groups),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = VpnPortalClientConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.VpnPortalClientConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<VpnPortalClientConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut virtual_ip__ = None;
                let mut groups__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::VirtualIp => {
                            if virtual_ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("virtualIp"));
                            }
                            virtual_ip__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Groups => {
                            if groups__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groups"));
                            }
                            groups__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(VpnPortalClientConfig {
                    name: name__.unwrap_or_default(),
                    virtual_ip: virtual_ip__.unwrap_or_default(),
                    groups: groups__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.manage.VpnPortalClientConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for VpnPortalConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.wireguard_listen.is_empty() {
            len += 1;
        }
        if self.wireguard_private_key.is_some() {
            len += 1;
        }
        if !self.clients.is_empty() {
            len += 1;
        }
        if self.enabled.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.manage.VpnPortalConfig", len)?;
        if !self.wireguard_listen.is_empty() {
            struct_ser.serialize_field("wireguard_listen", &self.wireguard_listen)?;
        }
        if let Some(v) = self.wireguard_private_key.as_ref() {
            struct_ser.serialize_field("wireguard_private_key", v)?;
        }
        if !self.clients.is_empty() {
            struct_ser.serialize_field("clients", &self.clients)?;
        }
        if let Some(v) = self.enabled.as_ref() {
            struct_ser.serialize_field("enabled", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for VpnPortalConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "wireguard_listen",
            "wireguardListen",
            "wireguard_private_key",
            "wireguardPrivateKey",
            "clients",
            "enabled",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            WireguardListen,
            WireguardPrivateKey,
            Clients,
            Enabled,
        }
        impl<'de> serde::Deserialize<'de> for GeneratedField {
            fn deserialize<D>(deserializer: D) -> std::result::Result<GeneratedField, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                struct GeneratedVisitor;

                impl serde::de::Visitor<'_> for GeneratedVisitor {
                    type Value = GeneratedField;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        write!(formatter, "expected one of: {:?}", &FIELDS)
                    }

                    #[allow(unused_variables)]
                    fn visit_str<E>(self, value: &str) -> std::result::Result<GeneratedField, E>
                    where
                        E: serde::de::Error,
                    {
                        match value {
                            "wireguardListen" | "wireguard_listen" => Ok(GeneratedField::WireguardListen),
                            "wireguardPrivateKey" | "wireguard_private_key" => Ok(GeneratedField::WireguardPrivateKey),
                            "clients" => Ok(GeneratedField::Clients),
                            "enabled" => Ok(GeneratedField::Enabled),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = VpnPortalConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.manage.VpnPortalConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<VpnPortalConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut wireguard_listen__ = None;
                let mut wireguard_private_key__ = None;
                let mut clients__ = None;
                let mut enabled__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::WireguardListen => {
                            if wireguard_listen__.is_some() {
                                return Err(serde::de::Error::duplicate_field("wireguardListen"));
                            }
                            wireguard_listen__ = Some(map_.next_value()?);
                        }
                        GeneratedField::WireguardPrivateKey => {
                            if wireguard_private_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("wireguardPrivateKey"));
                            }
                            wireguard_private_key__ = map_.next_value()?;
                        }
                        GeneratedField::Clients => {
                            if clients__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clients"));
                            }
                            clients__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = map_.next_value()?;
                        }
                    }
                }
                Ok(VpnPortalConfig {
                    wireguard_listen: wireguard_listen__.unwrap_or_default(),
                    wireguard_private_key: wireguard_private_key__,
                    clients: clients__.unwrap_or_default(),
                    enabled: enabled__,
                })
            }
        }
        deserializer.deserialize_struct("api.manage.VpnPortalConfig", FIELDS, GeneratedVisitor)
    }
}
