impl serde::Serialize for CoreConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.node.is_some() {
            len += 1;
        }
        if self.routes.is_some() {
            len += 1;
        }
        if self.peer_policy.is_some() {
            len += 1;
        }
        if self.traffic.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.CoreConfig", len)?;
        if let Some(v) = self.node.as_ref() {
            struct_ser.serialize_field("node", v)?;
        }
        if let Some(v) = self.routes.as_ref() {
            struct_ser.serialize_field("routes", v)?;
        }
        if let Some(v) = self.peer_policy.as_ref() {
            struct_ser.serialize_field("peer_policy", v)?;
        }
        if let Some(v) = self.traffic.as_ref() {
            struct_ser.serialize_field("traffic", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CoreConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "node",
            "routes",
            "peer_policy",
            "peerPolicy",
            "traffic",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Node,
            Routes,
            PeerPolicy,
            Traffic,
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
                            "node" => Ok(GeneratedField::Node),
                            "routes" => Ok(GeneratedField::Routes),
                            "peerPolicy" | "peer_policy" => Ok(GeneratedField::PeerPolicy),
                            "traffic" => Ok(GeneratedField::Traffic),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CoreConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.CoreConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CoreConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut node__ = None;
                let mut routes__ = None;
                let mut peer_policy__ = None;
                let mut traffic__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Node => {
                            if node__.is_some() {
                                return Err(serde::de::Error::duplicate_field("node"));
                            }
                            node__ = map_.next_value()?;
                        }
                        GeneratedField::Routes => {
                            if routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("routes"));
                            }
                            routes__ = map_.next_value()?;
                        }
                        GeneratedField::PeerPolicy => {
                            if peer_policy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerPolicy"));
                            }
                            peer_policy__ = map_.next_value()?;
                        }
                        GeneratedField::Traffic => {
                            if traffic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("traffic"));
                            }
                            traffic__ = map_.next_value()?;
                        }
                    }
                }
                Ok(CoreConfig {
                    node: node__,
                    routes: routes__,
                    peer_policy: peer_policy__,
                    traffic: traffic__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.CoreConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DnsConfigRaw {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.zone.is_some() {
            len += 1;
        }
        if self.domain.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.DnsConfigRaw", len)?;
        if let Some(v) = self.zone.as_ref() {
            struct_ser.serialize_field("zone", v)?;
        }
        if let Some(v) = self.domain.as_ref() {
            struct_ser.serialize_field("domain", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DnsConfigRaw {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "zone",
            "domain",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Zone,
            Domain,
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
                            "zone" => Ok(GeneratedField::Zone),
                            "domain" => Ok(GeneratedField::Domain),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DnsConfigRaw;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.DnsConfigRaw")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DnsConfigRaw, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut zone__ = None;
                let mut domain__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Zone => {
                            if zone__.is_some() {
                                return Err(serde::de::Error::duplicate_field("zone"));
                            }
                            zone__ = map_.next_value()?;
                        }
                        GeneratedField::Domain => {
                            if domain__.is_some() {
                                return Err(serde::de::Error::duplicate_field("domain"));
                            }
                            domain__ = map_.next_value()?;
                        }
                    }
                }
                Ok(DnsConfigRaw {
                    zone: zone__,
                    domain: domain__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.DnsConfigRaw", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DnsRecordRaw {
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
        if self.r#type != 0 {
            len += 1;
        }
        if self.ttl.is_some() {
            len += 1;
        }
        if self.value.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.DnsRecordRaw", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if self.r#type != 0 {
            let v = DnsRecordType::try_from(self.r#type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.r#type)))?;
            struct_ser.serialize_field("type", &v)?;
        }
        if let Some(v) = self.ttl.as_ref() {
            struct_ser.serialize_field("ttl", v)?;
        }
        if let Some(v) = self.value.as_ref() {
            struct_ser.serialize_field("value", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DnsRecordRaw {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "type",
            "ttl",
            "value",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Type,
            Ttl,
            Value,
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
                            "type" => Ok(GeneratedField::Type),
                            "ttl" => Ok(GeneratedField::Ttl),
                            "value" => Ok(GeneratedField::Value),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DnsRecordRaw;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.DnsRecordRaw")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DnsRecordRaw, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut r#type__ = None;
                let mut ttl__ = None;
                let mut value__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Type => {
                            if r#type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("type"));
                            }
                            r#type__ = Some(map_.next_value::<DnsRecordType>()? as i32);
                        }
                        GeneratedField::Ttl => {
                            if ttl__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ttl"));
                            }
                            ttl__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = map_.next_value()?;
                        }
                    }
                }
                Ok(DnsRecordRaw {
                    name: name__.unwrap_or_default(),
                    r#type: r#type__.unwrap_or_default(),
                    ttl: ttl__,
                    value: value__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.DnsRecordRaw", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DnsRecordType {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "DNS_RECORD_TYPE_UNSPECIFIED",
            Self::A => "A",
            Self::Ns => "NS",
            Self::Cname => "CNAME",
            Self::Soa => "SOA",
            Self::Ptr => "PTR",
            Self::Hinfo => "HINFO",
            Self::Mx => "MX",
            Self::Txt => "TXT",
            Self::Aaaa => "AAAA",
            Self::Srv => "SRV",
            Self::Naptr => "NAPTR",
            Self::Cert => "CERT",
            Self::Sshfp => "SSHFP",
            Self::Tlsa => "TLSA",
            Self::Csync => "CSYNC",
            Self::Svcb => "SVCB",
            Self::Https => "HTTPS",
            Self::Openpgpkey => "OPENPGPKEY",
            Self::Caa => "CAA",
            Self::Aname => "ANAME",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for DnsRecordType {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "DNS_RECORD_TYPE_UNSPECIFIED",
            "A",
            "NS",
            "CNAME",
            "SOA",
            "PTR",
            "HINFO",
            "MX",
            "TXT",
            "AAAA",
            "SRV",
            "NAPTR",
            "CERT",
            "SSHFP",
            "TLSA",
            "CSYNC",
            "SVCB",
            "HTTPS",
            "OPENPGPKEY",
            "CAA",
            "ANAME",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = DnsRecordType;

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
                    "DNS_RECORD_TYPE_UNSPECIFIED" => Ok(DnsRecordType::Unspecified),
                    "A" => Ok(DnsRecordType::A),
                    "NS" => Ok(DnsRecordType::Ns),
                    "CNAME" => Ok(DnsRecordType::Cname),
                    "SOA" => Ok(DnsRecordType::Soa),
                    "PTR" => Ok(DnsRecordType::Ptr),
                    "HINFO" => Ok(DnsRecordType::Hinfo),
                    "MX" => Ok(DnsRecordType::Mx),
                    "TXT" => Ok(DnsRecordType::Txt),
                    "AAAA" => Ok(DnsRecordType::Aaaa),
                    "SRV" => Ok(DnsRecordType::Srv),
                    "NAPTR" => Ok(DnsRecordType::Naptr),
                    "CERT" => Ok(DnsRecordType::Cert),
                    "SSHFP" => Ok(DnsRecordType::Sshfp),
                    "TLSA" => Ok(DnsRecordType::Tlsa),
                    "CSYNC" => Ok(DnsRecordType::Csync),
                    "SVCB" => Ok(DnsRecordType::Svcb),
                    "HTTPS" => Ok(DnsRecordType::Https),
                    "OPENPGPKEY" => Ok(DnsRecordType::Openpgpkey),
                    "CAA" => Ok(DnsRecordType::Caa),
                    "ANAME" => Ok(DnsRecordType::Aname),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for DnsZoneConfigRaw {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.origin.is_empty() {
            len += 1;
        }
        if self.ttl.is_some() {
            len += 1;
        }
        if self.records.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.DnsZoneConfigRaw", len)?;
        if !self.origin.is_empty() {
            struct_ser.serialize_field("origin", &self.origin)?;
        }
        if let Some(v) = self.ttl.as_ref() {
            struct_ser.serialize_field("ttl", v)?;
        }
        if let Some(v) = self.records.as_ref() {
            struct_ser.serialize_field("records", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DnsZoneConfigRaw {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "origin",
            "ttl",
            "records",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Origin,
            Ttl,
            Records,
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
                            "origin" => Ok(GeneratedField::Origin),
                            "ttl" => Ok(GeneratedField::Ttl),
                            "records" => Ok(GeneratedField::Records),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DnsZoneConfigRaw;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.DnsZoneConfigRaw")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DnsZoneConfigRaw, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut origin__ = None;
                let mut ttl__ = None;
                let mut records__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Origin => {
                            if origin__.is_some() {
                                return Err(serde::de::Error::duplicate_field("origin"));
                            }
                            origin__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Ttl => {
                            if ttl__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ttl"));
                            }
                            ttl__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Records => {
                            if records__.is_some() {
                                return Err(serde::de::Error::duplicate_field("records"));
                            }
                            records__ = map_.next_value()?;
                        }
                    }
                }
                Ok(DnsZoneConfigRaw {
                    origin: origin__.unwrap_or_default(),
                    ttl: ttl__,
                    records: records__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.DnsZoneConfigRaw", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ForeignNetworkConfig {
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
        if !self.cidrs.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.ForeignNetworkConfig", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.cidrs.is_empty() {
            struct_ser.serialize_field("cidrs", &self.cidrs)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ForeignNetworkConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "cidrs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Cidrs,
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
                            "cidrs" => Ok(GeneratedField::Cidrs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ForeignNetworkConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.ForeignNetworkConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ForeignNetworkConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut cidrs__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Cidrs => {
                            if cidrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cidrs"));
                            }
                            cidrs__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ForeignNetworkConfig {
                    name: name__.unwrap_or_default(),
                    cidrs: cidrs__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("core_config.ForeignNetworkConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for IpPrefix {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.address.is_some() {
            len += 1;
        }
        if self.prefix_len != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.IpPrefix", len)?;
        if let Some(v) = self.address.as_ref() {
            struct_ser.serialize_field("address", v)?;
        }
        if self.prefix_len != 0 {
            struct_ser.serialize_field("prefix_len", &self.prefix_len)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for IpPrefix {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "address",
            "prefix_len",
            "prefixLen",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Address,
            PrefixLen,
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
                            "address" => Ok(GeneratedField::Address),
                            "prefixLen" | "prefix_len" => Ok(GeneratedField::PrefixLen),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = IpPrefix;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.IpPrefix")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<IpPrefix, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut address__ = None;
                let mut prefix_len__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Address => {
                            if address__.is_some() {
                                return Err(serde::de::Error::duplicate_field("address"));
                            }
                            address__ = map_.next_value()?;
                        }
                        GeneratedField::PrefixLen => {
                            if prefix_len__.is_some() {
                                return Err(serde::de::Error::duplicate_field("prefixLen"));
                            }
                            prefix_len__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(IpPrefix {
                    address: address__,
                    prefix_len: prefix_len__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("core_config.IpPrefix", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NodeConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.peer_id.is_some() {
            len += 1;
        }
        if self.instance_id.is_some() {
            len += 1;
        }
        if self.hostname.is_some() {
            len += 1;
        }
        if !self.network_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.NodeConfig", len)?;
        if let Some(v) = self.peer_id.as_ref() {
            struct_ser.serialize_field("peer_id", v)?;
        }
        if let Some(v) = self.instance_id.as_ref() {
            struct_ser.serialize_field("instance_id", v)?;
        }
        if let Some(v) = self.hostname.as_ref() {
            struct_ser.serialize_field("hostname", v)?;
        }
        if !self.network_name.is_empty() {
            struct_ser.serialize_field("network_name", &self.network_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NodeConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "instance_id",
            "instanceId",
            "hostname",
            "network_name",
            "networkName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            InstanceId,
            Hostname,
            NetworkName,
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
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
                            "instanceId" | "instance_id" => Ok(GeneratedField::InstanceId),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "networkName" | "network_name" => Ok(GeneratedField::NetworkName),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NodeConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.NodeConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NodeConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut instance_id__ = None;
                let mut hostname__ = None;
                let mut network_name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::InstanceId => {
                            if instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceId"));
                            }
                            instance_id__ = map_.next_value()?;
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
                            network_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(NodeConfig {
                    peer_id: peer_id__,
                    instance_id: instance_id__,
                    hostname: hostname__,
                    network_name: network_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("core_config.NodeConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerPolicyConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.p2p_enabled.is_some() {
            len += 1;
        }
        if self.relay_peer_rpc.is_some() {
            len += 1;
        }
        if self.relay_data.is_some() {
            len += 1;
        }
        if self.latency_first.is_some() {
            len += 1;
        }
        if self.encryption_required.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.PeerPolicyConfig", len)?;
        if let Some(v) = self.p2p_enabled.as_ref() {
            struct_ser.serialize_field("p2p_enabled", v)?;
        }
        if let Some(v) = self.relay_peer_rpc.as_ref() {
            struct_ser.serialize_field("relay_peer_rpc", v)?;
        }
        if let Some(v) = self.relay_data.as_ref() {
            struct_ser.serialize_field("relay_data", v)?;
        }
        if let Some(v) = self.latency_first.as_ref() {
            struct_ser.serialize_field("latency_first", v)?;
        }
        if let Some(v) = self.encryption_required.as_ref() {
            struct_ser.serialize_field("encryption_required", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerPolicyConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "p2p_enabled",
            "p2pEnabled",
            "relay_peer_rpc",
            "relayPeerRpc",
            "relay_data",
            "relayData",
            "latency_first",
            "latencyFirst",
            "encryption_required",
            "encryptionRequired",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            P2pEnabled,
            RelayPeerRpc,
            RelayData,
            LatencyFirst,
            EncryptionRequired,
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
                            "p2pEnabled" | "p2p_enabled" => Ok(GeneratedField::P2pEnabled),
                            "relayPeerRpc" | "relay_peer_rpc" => Ok(GeneratedField::RelayPeerRpc),
                            "relayData" | "relay_data" => Ok(GeneratedField::RelayData),
                            "latencyFirst" | "latency_first" => Ok(GeneratedField::LatencyFirst),
                            "encryptionRequired" | "encryption_required" => Ok(GeneratedField::EncryptionRequired),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerPolicyConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.PeerPolicyConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerPolicyConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut p2p_enabled__ = None;
                let mut relay_peer_rpc__ = None;
                let mut relay_data__ = None;
                let mut latency_first__ = None;
                let mut encryption_required__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::P2pEnabled => {
                            if p2p_enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("p2pEnabled"));
                            }
                            p2p_enabled__ = map_.next_value()?;
                        }
                        GeneratedField::RelayPeerRpc => {
                            if relay_peer_rpc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayPeerRpc"));
                            }
                            relay_peer_rpc__ = map_.next_value()?;
                        }
                        GeneratedField::RelayData => {
                            if relay_data__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayData"));
                            }
                            relay_data__ = map_.next_value()?;
                        }
                        GeneratedField::LatencyFirst => {
                            if latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("latencyFirst"));
                            }
                            latency_first__ = map_.next_value()?;
                        }
                        GeneratedField::EncryptionRequired => {
                            if encryption_required__.is_some() {
                                return Err(serde::de::Error::duplicate_field("encryptionRequired"));
                            }
                            encryption_required__ = map_.next_value()?;
                        }
                    }
                }
                Ok(PeerPolicyConfig {
                    p2p_enabled: p2p_enabled__,
                    relay_peer_rpc: relay_peer_rpc__,
                    relay_data: relay_data__,
                    latency_first: latency_first__,
                    encryption_required: encryption_required__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.PeerPolicyConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ProxyNetworkConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.real.is_some() {
            len += 1;
        }
        if self.mapped.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.ProxyNetworkConfig", len)?;
        if let Some(v) = self.real.as_ref() {
            struct_ser.serialize_field("real", v)?;
        }
        if let Some(v) = self.mapped.as_ref() {
            struct_ser.serialize_field("mapped", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ProxyNetworkConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "real",
            "mapped",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Real,
            Mapped,
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
                            "real" => Ok(GeneratedField::Real),
                            "mapped" => Ok(GeneratedField::Mapped),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ProxyNetworkConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.ProxyNetworkConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ProxyNetworkConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut real__ = None;
                let mut mapped__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Real => {
                            if real__.is_some() {
                                return Err(serde::de::Error::duplicate_field("real"));
                            }
                            real__ = map_.next_value()?;
                        }
                        GeneratedField::Mapped => {
                            if mapped__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mapped"));
                            }
                            mapped__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ProxyNetworkConfig {
                    real: real__,
                    mapped: mapped__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.ProxyNetworkConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RouteConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.ipv4.is_some() {
            len += 1;
        }
        if self.ipv6.is_some() {
            len += 1;
        }
        if !self.advertised_routes.is_empty() {
            len += 1;
        }
        if !self.proxy_networks.is_empty() {
            len += 1;
        }
        if !self.foreign_networks.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.RouteConfig", len)?;
        if let Some(v) = self.ipv4.as_ref() {
            struct_ser.serialize_field("ipv4", v)?;
        }
        if let Some(v) = self.ipv6.as_ref() {
            struct_ser.serialize_field("ipv6", v)?;
        }
        if !self.advertised_routes.is_empty() {
            struct_ser.serialize_field("advertised_routes", &self.advertised_routes)?;
        }
        if !self.proxy_networks.is_empty() {
            struct_ser.serialize_field("proxy_networks", &self.proxy_networks)?;
        }
        if !self.foreign_networks.is_empty() {
            struct_ser.serialize_field("foreign_networks", &self.foreign_networks)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RouteConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "ipv4",
            "ipv6",
            "advertised_routes",
            "advertisedRoutes",
            "proxy_networks",
            "proxyNetworks",
            "foreign_networks",
            "foreignNetworks",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Ipv4,
            Ipv6,
            AdvertisedRoutes,
            ProxyNetworks,
            ForeignNetworks,
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
                            "ipv4" => Ok(GeneratedField::Ipv4),
                            "ipv6" => Ok(GeneratedField::Ipv6),
                            "advertisedRoutes" | "advertised_routes" => Ok(GeneratedField::AdvertisedRoutes),
                            "proxyNetworks" | "proxy_networks" => Ok(GeneratedField::ProxyNetworks),
                            "foreignNetworks" | "foreign_networks" => Ok(GeneratedField::ForeignNetworks),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RouteConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.RouteConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RouteConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut ipv4__ = None;
                let mut ipv6__ = None;
                let mut advertised_routes__ = None;
                let mut proxy_networks__ = None;
                let mut foreign_networks__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Ipv4 => {
                            if ipv4__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4"));
                            }
                            ipv4__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6 => {
                            if ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6"));
                            }
                            ipv6__ = map_.next_value()?;
                        }
                        GeneratedField::AdvertisedRoutes => {
                            if advertised_routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("advertisedRoutes"));
                            }
                            advertised_routes__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ProxyNetworks => {
                            if proxy_networks__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyNetworks"));
                            }
                            proxy_networks__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ForeignNetworks => {
                            if foreign_networks__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignNetworks"));
                            }
                            foreign_networks__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RouteConfig {
                    ipv4: ipv4__,
                    ipv6: ipv6__,
                    advertised_routes: advertised_routes__.unwrap_or_default(),
                    proxy_networks: proxy_networks__.unwrap_or_default(),
                    foreign_networks: foreign_networks__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("core_config.RouteConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TrafficConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.mtu.is_some() {
            len += 1;
        }
        if self.instance_recv_bps_limit.is_some() {
            len += 1;
        }
        if self.foreign_relay_bps_limit.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("core_config.TrafficConfig", len)?;
        if let Some(v) = self.mtu.as_ref() {
            struct_ser.serialize_field("mtu", v)?;
        }
        if let Some(v) = self.instance_recv_bps_limit.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("instance_recv_bps_limit", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.foreign_relay_bps_limit.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("foreign_relay_bps_limit", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TrafficConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "mtu",
            "instance_recv_bps_limit",
            "instanceRecvBpsLimit",
            "foreign_relay_bps_limit",
            "foreignRelayBpsLimit",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Mtu,
            InstanceRecvBpsLimit,
            ForeignRelayBpsLimit,
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
                            "mtu" => Ok(GeneratedField::Mtu),
                            "instanceRecvBpsLimit" | "instance_recv_bps_limit" => Ok(GeneratedField::InstanceRecvBpsLimit),
                            "foreignRelayBpsLimit" | "foreign_relay_bps_limit" => Ok(GeneratedField::ForeignRelayBpsLimit),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TrafficConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct core_config.TrafficConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TrafficConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut mtu__ = None;
                let mut instance_recv_bps_limit__ = None;
                let mut foreign_relay_bps_limit__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Mtu => {
                            if mtu__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mtu"));
                            }
                            mtu__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::InstanceRecvBpsLimit => {
                            if instance_recv_bps_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceRecvBpsLimit"));
                            }
                            instance_recv_bps_limit__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::ForeignRelayBpsLimit => {
                            if foreign_relay_bps_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignRelayBpsLimit"));
                            }
                            foreign_relay_bps_limit__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(TrafficConfig {
                    mtu: mtu__,
                    instance_recv_bps_limit: instance_recv_bps_limit__,
                    foreign_relay_bps_limit: foreign_relay_bps_limit__,
                })
            }
        }
        deserializer.deserialize_struct("core_config.TrafficConfig", FIELDS, GeneratedVisitor)
    }
}
