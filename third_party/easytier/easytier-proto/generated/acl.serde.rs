impl serde::Serialize for Acl {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.acl_v1.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.Acl", len)?;
        if let Some(v) = self.acl_v1.as_ref() {
            struct_ser.serialize_field("acl_v1", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Acl {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "acl_v1",
            "aclV1",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            AclV1,
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
                            "aclV1" | "acl_v1" => Ok(GeneratedField::AclV1),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Acl;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.Acl")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Acl, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut acl_v1__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::AclV1 => {
                            if acl_v1__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aclV1"));
                            }
                            acl_v1__ = map_.next_value()?;
                        }
                    }
                }
                Ok(Acl {
                    acl_v1: acl_v1__,
                })
            }
        }
        deserializer.deserialize_struct("acl.Acl", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for AclStats {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.rules.is_empty() {
            len += 1;
        }
        if !self.conn_track.is_empty() {
            len += 1;
        }
        if !self.global.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.AclStats", len)?;
        if !self.rules.is_empty() {
            struct_ser.serialize_field("rules", &self.rules)?;
        }
        if !self.conn_track.is_empty() {
            struct_ser.serialize_field("conn_track", &self.conn_track)?;
        }
        if !self.global.is_empty() {
            let v: std::collections::HashMap<_, _> = self.global.iter()
                .map(|(k, v)| (k, v.to_string())).collect();
            struct_ser.serialize_field("global", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AclStats {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "rules",
            "conn_track",
            "connTrack",
            "global",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Rules,
            ConnTrack,
            Global,
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
                            "rules" => Ok(GeneratedField::Rules),
                            "connTrack" | "conn_track" => Ok(GeneratedField::ConnTrack),
                            "global" => Ok(GeneratedField::Global),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AclStats;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.AclStats")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AclStats, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut rules__ = None;
                let mut conn_track__ = None;
                let mut global__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Rules => {
                            if rules__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rules"));
                            }
                            rules__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ConnTrack => {
                            if conn_track__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connTrack"));
                            }
                            conn_track__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Global => {
                            if global__.is_some() {
                                return Err(serde::de::Error::duplicate_field("global"));
                            }
                            global__ = Some(
                                map_.next_value::<std::collections::BTreeMap<_, ::pbjson::private::NumberDeserialize<u64>>>()?
                                    .into_iter().map(|(k,v)| (k, v.0)).collect()
                            );
                        }
                    }
                }
                Ok(AclStats {
                    rules: rules__.unwrap_or_default(),
                    conn_track: conn_track__.unwrap_or_default(),
                    global: global__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.AclStats", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for AclV1 {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.chains.is_empty() {
            len += 1;
        }
        if self.group.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.AclV1", len)?;
        if !self.chains.is_empty() {
            struct_ser.serialize_field("chains", &self.chains)?;
        }
        if let Some(v) = self.group.as_ref() {
            struct_ser.serialize_field("group", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AclV1 {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "chains",
            "group",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Chains,
            Group,
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
                            "chains" => Ok(GeneratedField::Chains),
                            "group" => Ok(GeneratedField::Group),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AclV1;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.AclV1")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AclV1, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut chains__ = None;
                let mut group__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Chains => {
                            if chains__.is_some() {
                                return Err(serde::de::Error::duplicate_field("chains"));
                            }
                            chains__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Group => {
                            if group__.is_some() {
                                return Err(serde::de::Error::duplicate_field("group"));
                            }
                            group__ = map_.next_value()?;
                        }
                    }
                }
                Ok(AclV1 {
                    chains: chains__.unwrap_or_default(),
                    group: group__,
                })
            }
        }
        deserializer.deserialize_struct("acl.AclV1", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Action {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Noop => "Noop",
            Self::Allow => "Allow",
            Self::Drop => "Drop",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for Action {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Noop",
            "Allow",
            "Drop",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = Action;

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
                    "Noop" => Ok(Action::Noop),
                    "Allow" => Ok(Action::Allow),
                    "Drop" => Ok(Action::Drop),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for Chain {
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
        if self.chain_type != 0 {
            len += 1;
        }
        if !self.description.is_empty() {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if !self.rules.is_empty() {
            len += 1;
        }
        if self.default_action != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.Chain", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if self.chain_type != 0 {
            let v = ChainType::try_from(self.chain_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.chain_type)))?;
            struct_ser.serialize_field("chain_type", &v)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if !self.rules.is_empty() {
            struct_ser.serialize_field("rules", &self.rules)?;
        }
        if self.default_action != 0 {
            let v = Action::try_from(self.default_action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.default_action)))?;
            struct_ser.serialize_field("default_action", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Chain {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "chain_type",
            "chainType",
            "description",
            "enabled",
            "rules",
            "default_action",
            "defaultAction",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            ChainType,
            Description,
            Enabled,
            Rules,
            DefaultAction,
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
                            "chainType" | "chain_type" => Ok(GeneratedField::ChainType),
                            "description" => Ok(GeneratedField::Description),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "rules" => Ok(GeneratedField::Rules),
                            "defaultAction" | "default_action" => Ok(GeneratedField::DefaultAction),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Chain;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.Chain")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Chain, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut chain_type__ = None;
                let mut description__ = None;
                let mut enabled__ = None;
                let mut rules__ = None;
                let mut default_action__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ChainType => {
                            if chain_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("chainType"));
                            }
                            chain_type__ = Some(map_.next_value::<ChainType>()? as i32);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Rules => {
                            if rules__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rules"));
                            }
                            rules__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DefaultAction => {
                            if default_action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("defaultAction"));
                            }
                            default_action__ = Some(map_.next_value::<Action>()? as i32);
                        }
                    }
                }
                Ok(Chain {
                    name: name__.unwrap_or_default(),
                    chain_type: chain_type__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    rules: rules__.unwrap_or_default(),
                    default_action: default_action__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.Chain", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ChainType {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::UnspecifiedChain => "UnspecifiedChain",
            Self::Inbound => "Inbound",
            Self::Outbound => "Outbound",
            Self::Forward => "Forward",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for ChainType {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "UnspecifiedChain",
            "Inbound",
            "Outbound",
            "Forward",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = ChainType;

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
                    "UnspecifiedChain" => Ok(ChainType::UnspecifiedChain),
                    "Inbound" => Ok(ChainType::Inbound),
                    "Outbound" => Ok(ChainType::Outbound),
                    "Forward" => Ok(ChainType::Forward),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for ConnState {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::New => "New",
            Self::Established => "Established",
            Self::Related => "Related",
            Self::Invalid => "Invalid",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for ConnState {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "New",
            "Established",
            "Related",
            "Invalid",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = ConnState;

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
                    "New" => Ok(ConnState::New),
                    "Established" => Ok(ConnState::Established),
                    "Related" => Ok(ConnState::Related),
                    "Invalid" => Ok(ConnState::Invalid),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for ConnTrackEntry {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.src_addr.is_some() {
            len += 1;
        }
        if self.dst_addr.is_some() {
            len += 1;
        }
        if self.protocol != 0 {
            len += 1;
        }
        if self.state != 0 {
            len += 1;
        }
        if self.created_at != 0 {
            len += 1;
        }
        if self.last_seen != 0 {
            len += 1;
        }
        if self.packet_count != 0 {
            len += 1;
        }
        if self.byte_count != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.ConnTrackEntry", len)?;
        if let Some(v) = self.src_addr.as_ref() {
            struct_ser.serialize_field("src_addr", v)?;
        }
        if let Some(v) = self.dst_addr.as_ref() {
            struct_ser.serialize_field("dst_addr", v)?;
        }
        if self.protocol != 0 {
            let v = Protocol::try_from(self.protocol)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.protocol)))?;
            struct_ser.serialize_field("protocol", &v)?;
        }
        if self.state != 0 {
            let v = ConnState::try_from(self.state)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.state)))?;
            struct_ser.serialize_field("state", &v)?;
        }
        if self.created_at != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("created_at", ToString::to_string(&self.created_at).as_str())?;
        }
        if self.last_seen != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("last_seen", ToString::to_string(&self.last_seen).as_str())?;
        }
        if self.packet_count != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("packet_count", ToString::to_string(&self.packet_count).as_str())?;
        }
        if self.byte_count != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("byte_count", ToString::to_string(&self.byte_count).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ConnTrackEntry {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "src_addr",
            "srcAddr",
            "dst_addr",
            "dstAddr",
            "protocol",
            "state",
            "created_at",
            "createdAt",
            "last_seen",
            "lastSeen",
            "packet_count",
            "packetCount",
            "byte_count",
            "byteCount",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SrcAddr,
            DstAddr,
            Protocol,
            State,
            CreatedAt,
            LastSeen,
            PacketCount,
            ByteCount,
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
                            "srcAddr" | "src_addr" => Ok(GeneratedField::SrcAddr),
                            "dstAddr" | "dst_addr" => Ok(GeneratedField::DstAddr),
                            "protocol" => Ok(GeneratedField::Protocol),
                            "state" => Ok(GeneratedField::State),
                            "createdAt" | "created_at" => Ok(GeneratedField::CreatedAt),
                            "lastSeen" | "last_seen" => Ok(GeneratedField::LastSeen),
                            "packetCount" | "packet_count" => Ok(GeneratedField::PacketCount),
                            "byteCount" | "byte_count" => Ok(GeneratedField::ByteCount),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ConnTrackEntry;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.ConnTrackEntry")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ConnTrackEntry, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut src_addr__ = None;
                let mut dst_addr__ = None;
                let mut protocol__ = None;
                let mut state__ = None;
                let mut created_at__ = None;
                let mut last_seen__ = None;
                let mut packet_count__ = None;
                let mut byte_count__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SrcAddr => {
                            if src_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("srcAddr"));
                            }
                            src_addr__ = map_.next_value()?;
                        }
                        GeneratedField::DstAddr => {
                            if dst_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dstAddr"));
                            }
                            dst_addr__ = map_.next_value()?;
                        }
                        GeneratedField::Protocol => {
                            if protocol__.is_some() {
                                return Err(serde::de::Error::duplicate_field("protocol"));
                            }
                            protocol__ = Some(map_.next_value::<Protocol>()? as i32);
                        }
                        GeneratedField::State => {
                            if state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("state"));
                            }
                            state__ = Some(map_.next_value::<ConnState>()? as i32);
                        }
                        GeneratedField::CreatedAt => {
                            if created_at__.is_some() {
                                return Err(serde::de::Error::duplicate_field("createdAt"));
                            }
                            created_at__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::LastSeen => {
                            if last_seen__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastSeen"));
                            }
                            last_seen__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PacketCount => {
                            if packet_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("packetCount"));
                            }
                            packet_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ByteCount => {
                            if byte_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("byteCount"));
                            }
                            byte_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(ConnTrackEntry {
                    src_addr: src_addr__,
                    dst_addr: dst_addr__,
                    protocol: protocol__.unwrap_or_default(),
                    state: state__.unwrap_or_default(),
                    created_at: created_at__.unwrap_or_default(),
                    last_seen: last_seen__.unwrap_or_default(),
                    packet_count: packet_count__.unwrap_or_default(),
                    byte_count: byte_count__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.ConnTrackEntry", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GroupIdentity {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.group_name.is_empty() {
            len += 1;
        }
        if !self.group_secret.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.GroupIdentity", len)?;
        if !self.group_name.is_empty() {
            struct_ser.serialize_field("group_name", &self.group_name)?;
        }
        if !self.group_secret.is_empty() {
            struct_ser.serialize_field("group_secret", &self.group_secret)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GroupIdentity {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "group_name",
            "groupName",
            "group_secret",
            "groupSecret",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            GroupName,
            GroupSecret,
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
                            "groupName" | "group_name" => Ok(GeneratedField::GroupName),
                            "groupSecret" | "group_secret" => Ok(GeneratedField::GroupSecret),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GroupIdentity;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.GroupIdentity")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GroupIdentity, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut group_name__ = None;
                let mut group_secret__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::GroupName => {
                            if group_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupName"));
                            }
                            group_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::GroupSecret => {
                            if group_secret__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupSecret"));
                            }
                            group_secret__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GroupIdentity {
                    group_name: group_name__.unwrap_or_default(),
                    group_secret: group_secret__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.GroupIdentity", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GroupInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.declares.is_empty() {
            len += 1;
        }
        if !self.members.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.GroupInfo", len)?;
        if !self.declares.is_empty() {
            struct_ser.serialize_field("declares", &self.declares)?;
        }
        if !self.members.is_empty() {
            struct_ser.serialize_field("members", &self.members)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GroupInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "declares",
            "members",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Declares,
            Members,
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
                            "declares" => Ok(GeneratedField::Declares),
                            "members" => Ok(GeneratedField::Members),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GroupInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.GroupInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GroupInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut declares__ = None;
                let mut members__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Declares => {
                            if declares__.is_some() {
                                return Err(serde::de::Error::duplicate_field("declares"));
                            }
                            declares__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Members => {
                            if members__.is_some() {
                                return Err(serde::de::Error::duplicate_field("members"));
                            }
                            members__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GroupInfo {
                    declares: declares__.unwrap_or_default(),
                    members: members__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.GroupInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Protocol {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "Unspecified",
            Self::Tcp => "TCP",
            Self::Udp => "UDP",
            Self::Icmp => "ICMP",
            Self::IcmPv6 => "ICMPv6",
            Self::Any => "Any",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for Protocol {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Unspecified",
            "TCP",
            "UDP",
            "ICMP",
            "ICMPv6",
            "Any",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = Protocol;

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
                    "Unspecified" => Ok(Protocol::Unspecified),
                    "TCP" => Ok(Protocol::Tcp),
                    "UDP" => Ok(Protocol::Udp),
                    "ICMP" => Ok(Protocol::Icmp),
                    "ICMPv6" => Ok(Protocol::IcmPv6),
                    "Any" => Ok(Protocol::Any),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for Rule {
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
        if !self.description.is_empty() {
            len += 1;
        }
        if self.priority != 0 {
            len += 1;
        }
        if self.enabled {
            len += 1;
        }
        if self.protocol != 0 {
            len += 1;
        }
        if !self.ports.is_empty() {
            len += 1;
        }
        if !self.source_ips.is_empty() {
            len += 1;
        }
        if !self.destination_ips.is_empty() {
            len += 1;
        }
        if !self.source_ports.is_empty() {
            len += 1;
        }
        if self.action != 0 {
            len += 1;
        }
        if self.rate_limit != 0 {
            len += 1;
        }
        if self.burst_limit != 0 {
            len += 1;
        }
        if self.stateful {
            len += 1;
        }
        if !self.source_groups.is_empty() {
            len += 1;
        }
        if !self.destination_groups.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.Rule", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.description.is_empty() {
            struct_ser.serialize_field("description", &self.description)?;
        }
        if self.priority != 0 {
            struct_ser.serialize_field("priority", &self.priority)?;
        }
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if self.protocol != 0 {
            let v = Protocol::try_from(self.protocol)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.protocol)))?;
            struct_ser.serialize_field("protocol", &v)?;
        }
        if !self.ports.is_empty() {
            struct_ser.serialize_field("ports", &self.ports)?;
        }
        if !self.source_ips.is_empty() {
            struct_ser.serialize_field("source_ips", &self.source_ips)?;
        }
        if !self.destination_ips.is_empty() {
            struct_ser.serialize_field("destination_ips", &self.destination_ips)?;
        }
        if !self.source_ports.is_empty() {
            struct_ser.serialize_field("source_ports", &self.source_ports)?;
        }
        if self.action != 0 {
            let v = Action::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if self.rate_limit != 0 {
            struct_ser.serialize_field("rate_limit", &self.rate_limit)?;
        }
        if self.burst_limit != 0 {
            struct_ser.serialize_field("burst_limit", &self.burst_limit)?;
        }
        if self.stateful {
            struct_ser.serialize_field("stateful", &self.stateful)?;
        }
        if !self.source_groups.is_empty() {
            struct_ser.serialize_field("source_groups", &self.source_groups)?;
        }
        if !self.destination_groups.is_empty() {
            struct_ser.serialize_field("destination_groups", &self.destination_groups)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Rule {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "description",
            "priority",
            "enabled",
            "protocol",
            "ports",
            "source_ips",
            "sourceIps",
            "destination_ips",
            "destinationIps",
            "source_ports",
            "sourcePorts",
            "action",
            "rate_limit",
            "rateLimit",
            "burst_limit",
            "burstLimit",
            "stateful",
            "source_groups",
            "sourceGroups",
            "destination_groups",
            "destinationGroups",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Description,
            Priority,
            Enabled,
            Protocol,
            Ports,
            SourceIps,
            DestinationIps,
            SourcePorts,
            Action,
            RateLimit,
            BurstLimit,
            Stateful,
            SourceGroups,
            DestinationGroups,
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
                            "description" => Ok(GeneratedField::Description),
                            "priority" => Ok(GeneratedField::Priority),
                            "enabled" => Ok(GeneratedField::Enabled),
                            "protocol" => Ok(GeneratedField::Protocol),
                            "ports" => Ok(GeneratedField::Ports),
                            "sourceIps" | "source_ips" => Ok(GeneratedField::SourceIps),
                            "destinationIps" | "destination_ips" => Ok(GeneratedField::DestinationIps),
                            "sourcePorts" | "source_ports" => Ok(GeneratedField::SourcePorts),
                            "action" => Ok(GeneratedField::Action),
                            "rateLimit" | "rate_limit" => Ok(GeneratedField::RateLimit),
                            "burstLimit" | "burst_limit" => Ok(GeneratedField::BurstLimit),
                            "stateful" => Ok(GeneratedField::Stateful),
                            "sourceGroups" | "source_groups" => Ok(GeneratedField::SourceGroups),
                            "destinationGroups" | "destination_groups" => Ok(GeneratedField::DestinationGroups),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Rule;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.Rule")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Rule, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut description__ = None;
                let mut priority__ = None;
                let mut enabled__ = None;
                let mut protocol__ = None;
                let mut ports__ = None;
                let mut source_ips__ = None;
                let mut destination_ips__ = None;
                let mut source_ports__ = None;
                let mut action__ = None;
                let mut rate_limit__ = None;
                let mut burst_limit__ = None;
                let mut stateful__ = None;
                let mut source_groups__ = None;
                let mut destination_groups__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Description => {
                            if description__.is_some() {
                                return Err(serde::de::Error::duplicate_field("description"));
                            }
                            description__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Priority => {
                            if priority__.is_some() {
                                return Err(serde::de::Error::duplicate_field("priority"));
                            }
                            priority__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Protocol => {
                            if protocol__.is_some() {
                                return Err(serde::de::Error::duplicate_field("protocol"));
                            }
                            protocol__ = Some(map_.next_value::<Protocol>()? as i32);
                        }
                        GeneratedField::Ports => {
                            if ports__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ports"));
                            }
                            ports__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SourceIps => {
                            if source_ips__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sourceIps"));
                            }
                            source_ips__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DestinationIps => {
                            if destination_ips__.is_some() {
                                return Err(serde::de::Error::duplicate_field("destinationIps"));
                            }
                            destination_ips__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SourcePorts => {
                            if source_ports__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sourcePorts"));
                            }
                            source_ports__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<Action>()? as i32);
                        }
                        GeneratedField::RateLimit => {
                            if rate_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rateLimit"));
                            }
                            rate_limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::BurstLimit => {
                            if burst_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("burstLimit"));
                            }
                            burst_limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Stateful => {
                            if stateful__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stateful"));
                            }
                            stateful__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SourceGroups => {
                            if source_groups__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sourceGroups"));
                            }
                            source_groups__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DestinationGroups => {
                            if destination_groups__.is_some() {
                                return Err(serde::de::Error::duplicate_field("destinationGroups"));
                            }
                            destination_groups__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Rule {
                    name: name__.unwrap_or_default(),
                    description: description__.unwrap_or_default(),
                    priority: priority__.unwrap_or_default(),
                    enabled: enabled__.unwrap_or_default(),
                    protocol: protocol__.unwrap_or_default(),
                    ports: ports__.unwrap_or_default(),
                    source_ips: source_ips__.unwrap_or_default(),
                    destination_ips: destination_ips__.unwrap_or_default(),
                    source_ports: source_ports__.unwrap_or_default(),
                    action: action__.unwrap_or_default(),
                    rate_limit: rate_limit__.unwrap_or_default(),
                    burst_limit: burst_limit__.unwrap_or_default(),
                    stateful: stateful__.unwrap_or_default(),
                    source_groups: source_groups__.unwrap_or_default(),
                    destination_groups: destination_groups__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.Rule", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RuleStats {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.rule.is_some() {
            len += 1;
        }
        if self.stat.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.RuleStats", len)?;
        if let Some(v) = self.rule.as_ref() {
            struct_ser.serialize_field("rule", v)?;
        }
        if let Some(v) = self.stat.as_ref() {
            struct_ser.serialize_field("stat", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RuleStats {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "rule",
            "stat",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Rule,
            Stat,
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
                            "rule" => Ok(GeneratedField::Rule),
                            "stat" => Ok(GeneratedField::Stat),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RuleStats;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.RuleStats")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RuleStats, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut rule__ = None;
                let mut stat__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Rule => {
                            if rule__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rule"));
                            }
                            rule__ = map_.next_value()?;
                        }
                        GeneratedField::Stat => {
                            if stat__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stat"));
                            }
                            stat__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RuleStats {
                    rule: rule__,
                    stat: stat__,
                })
            }
        }
        deserializer.deserialize_struct("acl.RuleStats", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for StatItem {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.packet_count != 0 {
            len += 1;
        }
        if self.byte_count != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.StatItem", len)?;
        if self.packet_count != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("packet_count", ToString::to_string(&self.packet_count).as_str())?;
        }
        if self.byte_count != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("byte_count", ToString::to_string(&self.byte_count).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for StatItem {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "packet_count",
            "packetCount",
            "byte_count",
            "byteCount",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PacketCount,
            ByteCount,
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
                            "packetCount" | "packet_count" => Ok(GeneratedField::PacketCount),
                            "byteCount" | "byte_count" => Ok(GeneratedField::ByteCount),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = StatItem;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.StatItem")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<StatItem, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut packet_count__ = None;
                let mut byte_count__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PacketCount => {
                            if packet_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("packetCount"));
                            }
                            packet_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ByteCount => {
                            if byte_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("byteCount"));
                            }
                            byte_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(StatItem {
                    packet_count: packet_count__.unwrap_or_default(),
                    byte_count: byte_count__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.StatItem", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TimeWindow {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.days_of_week.is_empty() {
            len += 1;
        }
        if self.start_time != 0 {
            len += 1;
        }
        if self.end_time != 0 {
            len += 1;
        }
        if self.timezone_offset != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("acl.TimeWindow", len)?;
        if !self.days_of_week.is_empty() {
            struct_ser.serialize_field("days_of_week", &self.days_of_week)?;
        }
        if self.start_time != 0 {
            struct_ser.serialize_field("start_time", &self.start_time)?;
        }
        if self.end_time != 0 {
            struct_ser.serialize_field("end_time", &self.end_time)?;
        }
        if self.timezone_offset != 0 {
            struct_ser.serialize_field("timezone_offset", &self.timezone_offset)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TimeWindow {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "days_of_week",
            "daysOfWeek",
            "start_time",
            "startTime",
            "end_time",
            "endTime",
            "timezone_offset",
            "timezoneOffset",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DaysOfWeek,
            StartTime,
            EndTime,
            TimezoneOffset,
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
                            "daysOfWeek" | "days_of_week" => Ok(GeneratedField::DaysOfWeek),
                            "startTime" | "start_time" => Ok(GeneratedField::StartTime),
                            "endTime" | "end_time" => Ok(GeneratedField::EndTime),
                            "timezoneOffset" | "timezone_offset" => Ok(GeneratedField::TimezoneOffset),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TimeWindow;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct acl.TimeWindow")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TimeWindow, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut days_of_week__ = None;
                let mut start_time__ = None;
                let mut end_time__ = None;
                let mut timezone_offset__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DaysOfWeek => {
                            if days_of_week__.is_some() {
                                return Err(serde::de::Error::duplicate_field("daysOfWeek"));
                            }
                            days_of_week__ = 
                                Some(map_.next_value::<Vec<::pbjson::private::NumberDeserialize<_>>>()?
                                    .into_iter().map(|x| x.0).collect())
                            ;
                        }
                        GeneratedField::StartTime => {
                            if start_time__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startTime"));
                            }
                            start_time__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::EndTime => {
                            if end_time__.is_some() {
                                return Err(serde::de::Error::duplicate_field("endTime"));
                            }
                            end_time__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TimezoneOffset => {
                            if timezone_offset__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timezoneOffset"));
                            }
                            timezone_offset__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(TimeWindow {
                    days_of_week: days_of_week__.unwrap_or_default(),
                    start_time: start_time__.unwrap_or_default(),
                    end_time: end_time__.unwrap_or_default(),
                    timezone_offset: timezone_offset__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("acl.TimeWindow", FIELDS, GeneratedVisitor)
    }
}
