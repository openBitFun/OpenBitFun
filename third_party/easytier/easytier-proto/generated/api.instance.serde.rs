impl serde::Serialize for Connector {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.url.is_some() {
            len += 1;
        }
        if self.status != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.Connector", len)?;
        if let Some(v) = self.url.as_ref() {
            struct_ser.serialize_field("url", v)?;
        }
        if self.status != 0 {
            let v = ConnectorStatus::try_from(self.status)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.status)))?;
            struct_ser.serialize_field("status", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Connector {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "url",
            "status",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Url,
            Status,
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
                            "url" => Ok(GeneratedField::Url),
                            "status" => Ok(GeneratedField::Status),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Connector;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.Connector")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Connector, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut url__ = None;
                let mut status__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Url => {
                            if url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("url"));
                            }
                            url__ = map_.next_value()?;
                        }
                        GeneratedField::Status => {
                            if status__.is_some() {
                                return Err(serde::de::Error::duplicate_field("status"));
                            }
                            status__ = Some(map_.next_value::<ConnectorStatus>()? as i32);
                        }
                    }
                }
                Ok(Connector {
                    url: url__,
                    status: status__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.Connector", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ConnectorStatus {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Connected => "CONNECTED",
            Self::Disconnected => "DISCONNECTED",
            Self::Connecting => "CONNECTING",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for ConnectorStatus {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "CONNECTED",
            "DISCONNECTED",
            "CONNECTING",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = ConnectorStatus;

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
                    "CONNECTED" => Ok(ConnectorStatus::Connected),
                    "DISCONNECTED" => Ok(ConnectorStatus::Disconnected),
                    "CONNECTING" => Ok(ConnectorStatus::Connecting),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for CredentialInfo {
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
        if !self.groups.is_empty() {
            len += 1;
        }
        if self.allow_relay {
            len += 1;
        }
        if self.expiry_unix != 0 {
            len += 1;
        }
        if !self.allowed_proxy_cidrs.is_empty() {
            len += 1;
        }
        if self.reusable.is_some() {
            len += 1;
        }
        if !self.public_key_fingerprint.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.CredentialInfo", len)?;
        if !self.credential_id.is_empty() {
            struct_ser.serialize_field("credential_id", &self.credential_id)?;
        }
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        if self.allow_relay {
            struct_ser.serialize_field("allow_relay", &self.allow_relay)?;
        }
        if self.expiry_unix != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expiry_unix", ToString::to_string(&self.expiry_unix).as_str())?;
        }
        if !self.allowed_proxy_cidrs.is_empty() {
            struct_ser.serialize_field("allowed_proxy_cidrs", &self.allowed_proxy_cidrs)?;
        }
        if let Some(v) = self.reusable.as_ref() {
            struct_ser.serialize_field("reusable", v)?;
        }
        if !self.public_key_fingerprint.is_empty() {
            struct_ser.serialize_field("public_key_fingerprint", &self.public_key_fingerprint)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for CredentialInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "credential_id",
            "credentialId",
            "groups",
            "allow_relay",
            "allowRelay",
            "expiry_unix",
            "expiryUnix",
            "allowed_proxy_cidrs",
            "allowedProxyCidrs",
            "reusable",
            "public_key_fingerprint",
            "publicKeyFingerprint",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CredentialId,
            Groups,
            AllowRelay,
            ExpiryUnix,
            AllowedProxyCidrs,
            Reusable,
            PublicKeyFingerprint,
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
                            "groups" => Ok(GeneratedField::Groups),
                            "allowRelay" | "allow_relay" => Ok(GeneratedField::AllowRelay),
                            "expiryUnix" | "expiry_unix" => Ok(GeneratedField::ExpiryUnix),
                            "allowedProxyCidrs" | "allowed_proxy_cidrs" => Ok(GeneratedField::AllowedProxyCidrs),
                            "reusable" => Ok(GeneratedField::Reusable),
                            "publicKeyFingerprint" | "public_key_fingerprint" => Ok(GeneratedField::PublicKeyFingerprint),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = CredentialInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.CredentialInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<CredentialInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut credential_id__ = None;
                let mut groups__ = None;
                let mut allow_relay__ = None;
                let mut expiry_unix__ = None;
                let mut allowed_proxy_cidrs__ = None;
                let mut reusable__ = None;
                let mut public_key_fingerprint__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CredentialId => {
                            if credential_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialId"));
                            }
                            credential_id__ = Some(map_.next_value()?);
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
                        GeneratedField::ExpiryUnix => {
                            if expiry_unix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiryUnix"));
                            }
                            expiry_unix__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::AllowedProxyCidrs => {
                            if allowed_proxy_cidrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("allowedProxyCidrs"));
                            }
                            allowed_proxy_cidrs__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Reusable => {
                            if reusable__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reusable"));
                            }
                            reusable__ = map_.next_value()?;
                        }
                        GeneratedField::PublicKeyFingerprint => {
                            if public_key_fingerprint__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicKeyFingerprint"));
                            }
                            public_key_fingerprint__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(CredentialInfo {
                    credential_id: credential_id__.unwrap_or_default(),
                    groups: groups__.unwrap_or_default(),
                    allow_relay: allow_relay__.unwrap_or_default(),
                    expiry_unix: expiry_unix__.unwrap_or_default(),
                    allowed_proxy_cidrs: allowed_proxy_cidrs__.unwrap_or_default(),
                    reusable: reusable__,
                    public_key_fingerprint: public_key_fingerprint__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.CredentialInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DumpRouteRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.DumpRouteRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DumpRouteRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DumpRouteRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.DumpRouteRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DumpRouteRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(DumpRouteRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.DumpRouteRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DumpRouteResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.result.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.DumpRouteResponse", len)?;
        if !self.result.is_empty() {
            struct_ser.serialize_field("result", &self.result)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DumpRouteResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "result",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Result,
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
                            "result" => Ok(GeneratedField::Result),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DumpRouteResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.DumpRouteResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DumpRouteResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut result__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Result => {
                            if result__.is_some() {
                                return Err(serde::de::Error::duplicate_field("result"));
                            }
                            result__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DumpRouteResponse {
                    result: result__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.DumpRouteResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ForeignNetworkEntryPb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.peers.is_empty() {
            len += 1;
        }
        if !self.network_secret_digest.is_empty() {
            len += 1;
        }
        if self.my_peer_id_for_this_network != 0 {
            len += 1;
        }
        if !self.trusted_keys.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ForeignNetworkEntryPb", len)?;
        if !self.peers.is_empty() {
            struct_ser.serialize_field("peers", &self.peers)?;
        }
        if !self.network_secret_digest.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("network_secret_digest", pbjson::private::base64::encode(&self.network_secret_digest).as_str())?;
        }
        if self.my_peer_id_for_this_network != 0 {
            struct_ser.serialize_field("my_peer_id_for_this_network", &self.my_peer_id_for_this_network)?;
        }
        if !self.trusted_keys.is_empty() {
            struct_ser.serialize_field("trusted_keys", &self.trusted_keys)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ForeignNetworkEntryPb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peers",
            "network_secret_digest",
            "networkSecretDigest",
            "my_peer_id_for_this_network",
            "myPeerIdForThisNetwork",
            "trusted_keys",
            "trustedKeys",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Peers,
            NetworkSecretDigest,
            MyPeerIdForThisNetwork,
            TrustedKeys,
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
                            "peers" => Ok(GeneratedField::Peers),
                            "networkSecretDigest" | "network_secret_digest" => Ok(GeneratedField::NetworkSecretDigest),
                            "myPeerIdForThisNetwork" | "my_peer_id_for_this_network" => Ok(GeneratedField::MyPeerIdForThisNetwork),
                            "trustedKeys" | "trusted_keys" => Ok(GeneratedField::TrustedKeys),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ForeignNetworkEntryPb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ForeignNetworkEntryPb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ForeignNetworkEntryPb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peers__ = None;
                let mut network_secret_digest__ = None;
                let mut my_peer_id_for_this_network__ = None;
                let mut trusted_keys__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Peers => {
                            if peers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peers"));
                            }
                            peers__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NetworkSecretDigest => {
                            if network_secret_digest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkSecretDigest"));
                            }
                            network_secret_digest__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MyPeerIdForThisNetwork => {
                            if my_peer_id_for_this_network__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myPeerIdForThisNetwork"));
                            }
                            my_peer_id_for_this_network__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TrustedKeys => {
                            if trusted_keys__.is_some() {
                                return Err(serde::de::Error::duplicate_field("trustedKeys"));
                            }
                            trusted_keys__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ForeignNetworkEntryPb {
                    peers: peers__.unwrap_or_default(),
                    network_secret_digest: network_secret_digest__.unwrap_or_default(),
                    my_peer_id_for_this_network: my_peer_id_for_this_network__.unwrap_or_default(),
                    trusted_keys: trusted_keys__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ForeignNetworkEntryPb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GenerateCredentialRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.groups.is_empty() {
            len += 1;
        }
        if self.allow_relay {
            len += 1;
        }
        if !self.allowed_proxy_cidrs.is_empty() {
            len += 1;
        }
        if self.ttl_seconds != 0 {
            len += 1;
        }
        if self.credential_id.is_some() {
            len += 1;
        }
        if self.instance.is_some() {
            len += 1;
        }
        if self.reusable.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GenerateCredentialRequest", len)?;
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        if self.allow_relay {
            struct_ser.serialize_field("allow_relay", &self.allow_relay)?;
        }
        if !self.allowed_proxy_cidrs.is_empty() {
            struct_ser.serialize_field("allowed_proxy_cidrs", &self.allowed_proxy_cidrs)?;
        }
        if self.ttl_seconds != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("ttl_seconds", ToString::to_string(&self.ttl_seconds).as_str())?;
        }
        if let Some(v) = self.credential_id.as_ref() {
            struct_ser.serialize_field("credential_id", v)?;
        }
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        if let Some(v) = self.reusable.as_ref() {
            struct_ser.serialize_field("reusable", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GenerateCredentialRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "groups",
            "allow_relay",
            "allowRelay",
            "allowed_proxy_cidrs",
            "allowedProxyCidrs",
            "ttl_seconds",
            "ttlSeconds",
            "credential_id",
            "credentialId",
            "instance",
            "reusable",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Groups,
            AllowRelay,
            AllowedProxyCidrs,
            TtlSeconds,
            CredentialId,
            Instance,
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
                            "groups" => Ok(GeneratedField::Groups),
                            "allowRelay" | "allow_relay" => Ok(GeneratedField::AllowRelay),
                            "allowedProxyCidrs" | "allowed_proxy_cidrs" => Ok(GeneratedField::AllowedProxyCidrs),
                            "ttlSeconds" | "ttl_seconds" => Ok(GeneratedField::TtlSeconds),
                            "credentialId" | "credential_id" => Ok(GeneratedField::CredentialId),
                            "instance" => Ok(GeneratedField::Instance),
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
            type Value = GenerateCredentialRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GenerateCredentialRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GenerateCredentialRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut groups__ = None;
                let mut allow_relay__ = None;
                let mut allowed_proxy_cidrs__ = None;
                let mut ttl_seconds__ = None;
                let mut credential_id__ = None;
                let mut instance__ = None;
                let mut reusable__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
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
                        GeneratedField::TtlSeconds => {
                            if ttl_seconds__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ttlSeconds"));
                            }
                            ttl_seconds__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::CredentialId => {
                            if credential_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialId"));
                            }
                            credential_id__ = map_.next_value()?;
                        }
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                        GeneratedField::Reusable => {
                            if reusable__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reusable"));
                            }
                            reusable__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GenerateCredentialRequest {
                    groups: groups__.unwrap_or_default(),
                    allow_relay: allow_relay__.unwrap_or_default(),
                    allowed_proxy_cidrs: allowed_proxy_cidrs__.unwrap_or_default(),
                    ttl_seconds: ttl_seconds__.unwrap_or_default(),
                    credential_id: credential_id__,
                    instance: instance__,
                    reusable: reusable__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GenerateCredentialRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GenerateCredentialResponse {
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
        if self.expiry_unix != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GenerateCredentialResponse", len)?;
        if !self.credential_id.is_empty() {
            struct_ser.serialize_field("credential_id", &self.credential_id)?;
        }
        if !self.credential_secret.is_empty() {
            struct_ser.serialize_field("credential_secret", &self.credential_secret)?;
        }
        if self.expiry_unix != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expiry_unix", ToString::to_string(&self.expiry_unix).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GenerateCredentialResponse {
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
            "expiry_unix",
            "expiryUnix",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CredentialId,
            CredentialSecret,
            ExpiryUnix,
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
                            "expiryUnix" | "expiry_unix" => Ok(GeneratedField::ExpiryUnix),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GenerateCredentialResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GenerateCredentialResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GenerateCredentialResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut credential_id__ = None;
                let mut credential_secret__ = None;
                let mut expiry_unix__ = None;
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
                        GeneratedField::ExpiryUnix => {
                            if expiry_unix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiryUnix"));
                            }
                            expiry_unix__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(GenerateCredentialResponse {
                    credential_id: credential_id__.unwrap_or_default(),
                    credential_secret: credential_secret__.unwrap_or_default(),
                    expiry_unix: expiry_unix__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GenerateCredentialResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetAclStatsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetAclStatsRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetAclStatsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetAclStatsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetAclStatsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetAclStatsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetAclStatsRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetAclStatsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetAclStatsResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.acl_stats.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetAclStatsResponse", len)?;
        if let Some(v) = self.acl_stats.as_ref() {
            struct_ser.serialize_field("acl_stats", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetAclStatsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "acl_stats",
            "aclStats",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            AclStats,
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
                            "aclStats" | "acl_stats" => Ok(GeneratedField::AclStats),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetAclStatsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetAclStatsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetAclStatsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut acl_stats__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::AclStats => {
                            if acl_stats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aclStats"));
                            }
                            acl_stats__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetAclStatsResponse {
                    acl_stats: acl_stats__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetAclStatsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetForeignNetworkSummaryRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetForeignNetworkSummaryRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetForeignNetworkSummaryRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetForeignNetworkSummaryRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetForeignNetworkSummaryRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetForeignNetworkSummaryRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetForeignNetworkSummaryRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetForeignNetworkSummaryRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetForeignNetworkSummaryResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.summary.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetForeignNetworkSummaryResponse", len)?;
        if let Some(v) = self.summary.as_ref() {
            struct_ser.serialize_field("summary", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetForeignNetworkSummaryResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "summary",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Summary,
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
                            "summary" => Ok(GeneratedField::Summary),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetForeignNetworkSummaryResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetForeignNetworkSummaryResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetForeignNetworkSummaryResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut summary__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Summary => {
                            if summary__.is_some() {
                                return Err(serde::de::Error::duplicate_field("summary"));
                            }
                            summary__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetForeignNetworkSummaryResponse {
                    summary: summary__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetForeignNetworkSummaryResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetPrometheusStatsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetPrometheusStatsRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetPrometheusStatsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetPrometheusStatsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetPrometheusStatsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetPrometheusStatsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetPrometheusStatsRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetPrometheusStatsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetPrometheusStatsResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.prometheus_text.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetPrometheusStatsResponse", len)?;
        if !self.prometheus_text.is_empty() {
            struct_ser.serialize_field("prometheus_text", &self.prometheus_text)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetPrometheusStatsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "prometheus_text",
            "prometheusText",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PrometheusText,
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
                            "prometheusText" | "prometheus_text" => Ok(GeneratedField::PrometheusText),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetPrometheusStatsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetPrometheusStatsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetPrometheusStatsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut prometheus_text__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PrometheusText => {
                            if prometheus_text__.is_some() {
                                return Err(serde::de::Error::duplicate_field("prometheusText"));
                            }
                            prometheus_text__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetPrometheusStatsResponse {
                    prometheus_text: prometheus_text__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetPrometheusStatsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetStatsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetStatsRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetStatsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetStatsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetStatsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetStatsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetStatsRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetStatsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetStatsResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.metrics.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetStatsResponse", len)?;
        if !self.metrics.is_empty() {
            struct_ser.serialize_field("metrics", &self.metrics)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetStatsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "metrics",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Metrics,
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
                            "metrics" => Ok(GeneratedField::Metrics),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetStatsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetStatsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetStatsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut metrics__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Metrics => {
                            if metrics__.is_some() {
                                return Err(serde::de::Error::duplicate_field("metrics"));
                            }
                            metrics__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetStatsResponse {
                    metrics: metrics__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetStatsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetVpnPortalInfoRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetVpnPortalInfoRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetVpnPortalInfoRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetVpnPortalInfoRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetVpnPortalInfoRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetVpnPortalInfoRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetVpnPortalInfoRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetVpnPortalInfoRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetVpnPortalInfoResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.vpn_portal_info.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetVpnPortalInfoResponse", len)?;
        if let Some(v) = self.vpn_portal_info.as_ref() {
            struct_ser.serialize_field("vpn_portal_info", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetVpnPortalInfoResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "vpn_portal_info",
            "vpnPortalInfo",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            VpnPortalInfo,
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
                            "vpnPortalInfo" | "vpn_portal_info" => Ok(GeneratedField::VpnPortalInfo),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetVpnPortalInfoResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetVpnPortalInfoResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetVpnPortalInfoResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut vpn_portal_info__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::VpnPortalInfo => {
                            if vpn_portal_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalInfo"));
                            }
                            vpn_portal_info__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetVpnPortalInfoResponse {
                    vpn_portal_info: vpn_portal_info__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetVpnPortalInfoResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetWhitelistRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetWhitelistRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetWhitelistRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetWhitelistRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetWhitelistRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetWhitelistRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetWhitelistRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetWhitelistRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetWhitelistResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.tcp_ports.is_empty() {
            len += 1;
        }
        if !self.udp_ports.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.GetWhitelistResponse", len)?;
        if !self.tcp_ports.is_empty() {
            struct_ser.serialize_field("tcp_ports", &self.tcp_ports)?;
        }
        if !self.udp_ports.is_empty() {
            struct_ser.serialize_field("udp_ports", &self.udp_ports)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetWhitelistResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "tcp_ports",
            "tcpPorts",
            "udp_ports",
            "udpPorts",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            TcpPorts,
            UdpPorts,
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
                            "tcpPorts" | "tcp_ports" => Ok(GeneratedField::TcpPorts),
                            "udpPorts" | "udp_ports" => Ok(GeneratedField::UdpPorts),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetWhitelistResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.GetWhitelistResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetWhitelistResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut tcp_ports__ = None;
                let mut udp_ports__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::TcpPorts => {
                            if tcp_ports__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tcpPorts"));
                            }
                            tcp_ports__ = Some(map_.next_value()?);
                        }
                        GeneratedField::UdpPorts => {
                            if udp_ports__.is_some() {
                                return Err(serde::de::Error::duplicate_field("udpPorts"));
                            }
                            udp_ports__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetWhitelistResponse {
                    tcp_ports: tcp_ports__.unwrap_or_default(),
                    udp_ports: udp_ports__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.GetWhitelistResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for InstanceIdentifier {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.selector.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.InstanceIdentifier", len)?;
        if let Some(v) = self.selector.as_ref() {
            match v {
                instance_identifier::Selector::Id(v) => {
                    struct_ser.serialize_field("id", v)?;
                }
                instance_identifier::Selector::InstanceSelector(v) => {
                    struct_ser.serialize_field("instance_selector", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for InstanceIdentifier {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "id",
            "instance_selector",
            "instanceSelector",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Id,
            InstanceSelector,
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
                            "id" => Ok(GeneratedField::Id),
                            "instanceSelector" | "instance_selector" => Ok(GeneratedField::InstanceSelector),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = InstanceIdentifier;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.InstanceIdentifier")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<InstanceIdentifier, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut selector__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Id => {
                            if selector__.is_some() {
                                return Err(serde::de::Error::duplicate_field("id"));
                            }
                            selector__ = map_.next_value::<::std::option::Option<_>>()?.map(instance_identifier::Selector::Id)
;
                        }
                        GeneratedField::InstanceSelector => {
                            if selector__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceSelector"));
                            }
                            selector__ = map_.next_value::<::std::option::Option<_>>()?.map(instance_identifier::Selector::InstanceSelector)
;
                        }
                    }
                }
                Ok(InstanceIdentifier {
                    selector: selector__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.InstanceIdentifier", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for instance_identifier::InstanceSelector {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.name.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.InstanceIdentifier.InstanceSelector", len)?;
        if let Some(v) = self.name.as_ref() {
            struct_ser.serialize_field("name", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for instance_identifier::InstanceSelector {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = instance_identifier::InstanceSelector;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.InstanceIdentifier.InstanceSelector")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<instance_identifier::InstanceSelector, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = map_.next_value()?;
                        }
                    }
                }
                Ok(instance_identifier::InstanceSelector {
                    name: name__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.InstanceIdentifier.InstanceSelector", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListConnectorRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListConnectorRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListConnectorRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListConnectorRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListConnectorRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListConnectorRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListConnectorRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListConnectorRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListConnectorResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.connectors.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListConnectorResponse", len)?;
        if !self.connectors.is_empty() {
            struct_ser.serialize_field("connectors", &self.connectors)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListConnectorResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "connectors",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Connectors,
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
                            "connectors" => Ok(GeneratedField::Connectors),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListConnectorResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListConnectorResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListConnectorResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut connectors__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Connectors => {
                            if connectors__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectors"));
                            }
                            connectors__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListConnectorResponse {
                    connectors: connectors__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListConnectorResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListCredentialsRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListCredentialsRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListCredentialsRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListCredentialsRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListCredentialsRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListCredentialsRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListCredentialsRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListCredentialsRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListCredentialsResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.credentials.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListCredentialsResponse", len)?;
        if !self.credentials.is_empty() {
            struct_ser.serialize_field("credentials", &self.credentials)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListCredentialsResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "credentials",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Credentials,
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
                            "credentials" => Ok(GeneratedField::Credentials),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListCredentialsResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListCredentialsResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListCredentialsResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut credentials__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Credentials => {
                            if credentials__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentials"));
                            }
                            credentials__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListCredentialsResponse {
                    credentials: credentials__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListCredentialsResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListForeignNetworkRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        if self.include_trusted_keys {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListForeignNetworkRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        if self.include_trusted_keys {
            struct_ser.serialize_field("include_trusted_keys", &self.include_trusted_keys)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListForeignNetworkRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
            "include_trusted_keys",
            "includeTrustedKeys",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
            IncludeTrustedKeys,
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
                            "instance" => Ok(GeneratedField::Instance),
                            "includeTrustedKeys" | "include_trusted_keys" => Ok(GeneratedField::IncludeTrustedKeys),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListForeignNetworkRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListForeignNetworkRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListForeignNetworkRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                let mut include_trusted_keys__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                        GeneratedField::IncludeTrustedKeys => {
                            if include_trusted_keys__.is_some() {
                                return Err(serde::de::Error::duplicate_field("includeTrustedKeys"));
                            }
                            include_trusted_keys__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListForeignNetworkRequest {
                    instance: instance__,
                    include_trusted_keys: include_trusted_keys__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListForeignNetworkRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListForeignNetworkResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.foreign_networks.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListForeignNetworkResponse", len)?;
        if !self.foreign_networks.is_empty() {
            struct_ser.serialize_field("foreign_networks", &self.foreign_networks)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListForeignNetworkResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "foreign_networks",
            "foreignNetworks",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
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
            type Value = ListForeignNetworkResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListForeignNetworkResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListForeignNetworkResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut foreign_networks__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ForeignNetworks => {
                            if foreign_networks__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignNetworks"));
                            }
                            foreign_networks__ = Some(
                                map_.next_value::<std::collections::BTreeMap<_, _>>()?
                            );
                        }
                    }
                }
                Ok(ListForeignNetworkResponse {
                    foreign_networks: foreign_networks__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListForeignNetworkResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListGlobalForeignNetworkRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListGlobalForeignNetworkRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListGlobalForeignNetworkRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListGlobalForeignNetworkRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListGlobalForeignNetworkRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListGlobalForeignNetworkRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListGlobalForeignNetworkRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListGlobalForeignNetworkRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListGlobalForeignNetworkResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.foreign_networks.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListGlobalForeignNetworkResponse", len)?;
        if !self.foreign_networks.is_empty() {
            struct_ser.serialize_field("foreign_networks", &self.foreign_networks)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListGlobalForeignNetworkResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "foreign_networks",
            "foreignNetworks",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
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
            type Value = ListGlobalForeignNetworkResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListGlobalForeignNetworkResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListGlobalForeignNetworkResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut foreign_networks__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ForeignNetworks => {
                            if foreign_networks__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignNetworks"));
                            }
                            foreign_networks__ = Some(
                                map_.next_value::<std::collections::BTreeMap<::pbjson::private::NumberDeserialize<u32>, _>>()?
                                    .into_iter().map(|(k,v)| (k.0, v)).collect()
                            );
                        }
                    }
                }
                Ok(ListGlobalForeignNetworkResponse {
                    foreign_networks: foreign_networks__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListGlobalForeignNetworkResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for list_global_foreign_network_response::ForeignNetworks {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.foreign_networks.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListGlobalForeignNetworkResponse.ForeignNetworks", len)?;
        if !self.foreign_networks.is_empty() {
            struct_ser.serialize_field("foreign_networks", &self.foreign_networks)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for list_global_foreign_network_response::ForeignNetworks {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "foreign_networks",
            "foreignNetworks",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
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
            type Value = list_global_foreign_network_response::ForeignNetworks;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListGlobalForeignNetworkResponse.ForeignNetworks")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<list_global_foreign_network_response::ForeignNetworks, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut foreign_networks__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ForeignNetworks => {
                            if foreign_networks__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignNetworks"));
                            }
                            foreign_networks__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(list_global_foreign_network_response::ForeignNetworks {
                    foreign_networks: foreign_networks__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListGlobalForeignNetworkResponse.ForeignNetworks", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for list_global_foreign_network_response::OneForeignNetwork {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.network_name.is_empty() {
            len += 1;
        }
        if !self.peer_ids.is_empty() {
            len += 1;
        }
        if !self.last_updated.is_empty() {
            len += 1;
        }
        if self.version != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListGlobalForeignNetworkResponse.OneForeignNetwork", len)?;
        if !self.network_name.is_empty() {
            struct_ser.serialize_field("network_name", &self.network_name)?;
        }
        if !self.peer_ids.is_empty() {
            struct_ser.serialize_field("peer_ids", &self.peer_ids)?;
        }
        if !self.last_updated.is_empty() {
            struct_ser.serialize_field("last_updated", &self.last_updated)?;
        }
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for list_global_foreign_network_response::OneForeignNetwork {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "network_name",
            "networkName",
            "peer_ids",
            "peerIds",
            "last_updated",
            "lastUpdated",
            "version",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            NetworkName,
            PeerIds,
            LastUpdated,
            Version,
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
                            "networkName" | "network_name" => Ok(GeneratedField::NetworkName),
                            "peerIds" | "peer_ids" => Ok(GeneratedField::PeerIds),
                            "lastUpdated" | "last_updated" => Ok(GeneratedField::LastUpdated),
                            "version" => Ok(GeneratedField::Version),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = list_global_foreign_network_response::OneForeignNetwork;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListGlobalForeignNetworkResponse.OneForeignNetwork")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<list_global_foreign_network_response::OneForeignNetwork, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut network_name__ = None;
                let mut peer_ids__ = None;
                let mut last_updated__ = None;
                let mut version__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::NetworkName => {
                            if network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkName"));
                            }
                            network_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PeerIds => {
                            if peer_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerIds"));
                            }
                            peer_ids__ = 
                                Some(map_.next_value::<Vec<::pbjson::private::NumberDeserialize<_>>>()?
                                    .into_iter().map(|x| x.0).collect())
                            ;
                        }
                        GeneratedField::LastUpdated => {
                            if last_updated__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastUpdated"));
                            }
                            last_updated__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(list_global_foreign_network_response::OneForeignNetwork {
                    network_name: network_name__.unwrap_or_default(),
                    peer_ids: peer_ids__.unwrap_or_default(),
                    last_updated: last_updated__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListGlobalForeignNetworkResponse.OneForeignNetwork", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListMappedListenerRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListMappedListenerRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListMappedListenerRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListMappedListenerRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListMappedListenerRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListMappedListenerRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListMappedListenerRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListMappedListenerRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListMappedListenerResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.mappedlisteners.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListMappedListenerResponse", len)?;
        if !self.mappedlisteners.is_empty() {
            struct_ser.serialize_field("mappedlisteners", &self.mappedlisteners)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListMappedListenerResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "mappedlisteners",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Mappedlisteners,
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
                            "mappedlisteners" => Ok(GeneratedField::Mappedlisteners),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListMappedListenerResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListMappedListenerResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListMappedListenerResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut mappedlisteners__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Mappedlisteners => {
                            if mappedlisteners__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mappedlisteners"));
                            }
                            mappedlisteners__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListMappedListenerResponse {
                    mappedlisteners: mappedlisteners__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListMappedListenerResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPeerRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListPeerRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPeerRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPeerRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListPeerRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPeerRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListPeerRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListPeerRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPeerResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.peer_infos.is_empty() {
            len += 1;
        }
        if self.my_info.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListPeerResponse", len)?;
        if !self.peer_infos.is_empty() {
            struct_ser.serialize_field("peer_infos", &self.peer_infos)?;
        }
        if let Some(v) = self.my_info.as_ref() {
            struct_ser.serialize_field("my_info", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPeerResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_infos",
            "peerInfos",
            "my_info",
            "myInfo",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerInfos,
            MyInfo,
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
                            "peerInfos" | "peer_infos" => Ok(GeneratedField::PeerInfos),
                            "myInfo" | "my_info" => Ok(GeneratedField::MyInfo),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPeerResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListPeerResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPeerResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_infos__ = None;
                let mut my_info__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerInfos => {
                            if peer_infos__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerInfos"));
                            }
                            peer_infos__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MyInfo => {
                            if my_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myInfo"));
                            }
                            my_info__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListPeerResponse {
                    peer_infos: peer_infos__.unwrap_or_default(),
                    my_info: my_info__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListPeerResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPortForwardRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListPortForwardRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPortForwardRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPortForwardRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListPortForwardRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPortForwardRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListPortForwardRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListPortForwardRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPortForwardResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.cfgs.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListPortForwardResponse", len)?;
        if !self.cfgs.is_empty() {
            struct_ser.serialize_field("cfgs", &self.cfgs)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPortForwardResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "cfgs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Cfgs,
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
                            "cfgs" => Ok(GeneratedField::Cfgs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPortForwardResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListPortForwardResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPortForwardResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut cfgs__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Cfgs => {
                            if cfgs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cfgs"));
                            }
                            cfgs__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListPortForwardResponse {
                    cfgs: cfgs__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListPortForwardResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPublicIpv6InfoRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListPublicIpv6InfoRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPublicIpv6InfoRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPublicIpv6InfoRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListPublicIpv6InfoRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPublicIpv6InfoRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListPublicIpv6InfoRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListPublicIpv6InfoRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListPublicIpv6InfoResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.provider_prefix.is_some() {
            len += 1;
        }
        if !self.provider_leases.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListPublicIpv6InfoResponse", len)?;
        if let Some(v) = self.provider_prefix.as_ref() {
            struct_ser.serialize_field("provider_prefix", v)?;
        }
        if !self.provider_leases.is_empty() {
            struct_ser.serialize_field("provider_leases", &self.provider_leases)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListPublicIpv6InfoResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "provider_prefix",
            "providerPrefix",
            "provider_leases",
            "providerLeases",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ProviderPrefix,
            ProviderLeases,
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
                            "providerPrefix" | "provider_prefix" => Ok(GeneratedField::ProviderPrefix),
                            "providerLeases" | "provider_leases" => Ok(GeneratedField::ProviderLeases),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListPublicIpv6InfoResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListPublicIpv6InfoResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListPublicIpv6InfoResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut provider_prefix__ = None;
                let mut provider_leases__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ProviderPrefix => {
                            if provider_prefix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("providerPrefix"));
                            }
                            provider_prefix__ = map_.next_value()?;
                        }
                        GeneratedField::ProviderLeases => {
                            if provider_leases__.is_some() {
                                return Err(serde::de::Error::duplicate_field("providerLeases"));
                            }
                            provider_leases__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListPublicIpv6InfoResponse {
                    provider_prefix: provider_prefix__,
                    provider_leases: provider_leases__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListPublicIpv6InfoResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListRouteRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListRouteRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListRouteRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListRouteRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListRouteRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListRouteRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListRouteRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListRouteRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListRouteResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.routes.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListRouteResponse", len)?;
        if !self.routes.is_empty() {
            struct_ser.serialize_field("routes", &self.routes)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListRouteResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "routes",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Routes,
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
                            "routes" => Ok(GeneratedField::Routes),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListRouteResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListRouteResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListRouteResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut routes__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Routes => {
                            if routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("routes"));
                            }
                            routes__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ListRouteResponse {
                    routes: routes__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListRouteResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListTcpProxyEntryRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ListTcpProxyEntryRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListTcpProxyEntryRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ListTcpProxyEntryRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListTcpProxyEntryRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListTcpProxyEntryRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ListTcpProxyEntryRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListTcpProxyEntryRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ListTcpProxyEntryResponse {
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
        let mut struct_ser = serializer.serialize_struct("api.instance.ListTcpProxyEntryResponse", len)?;
        if !self.entries.is_empty() {
            struct_ser.serialize_field("entries", &self.entries)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ListTcpProxyEntryResponse {
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
            type Value = ListTcpProxyEntryResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ListTcpProxyEntryResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ListTcpProxyEntryResponse, V::Error>
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
                Ok(ListTcpProxyEntryResponse {
                    entries: entries__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ListTcpProxyEntryResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for MappedListener {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.url.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.MappedListener", len)?;
        if let Some(v) = self.url.as_ref() {
            struct_ser.serialize_field("url", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for MappedListener {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "url",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Url,
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
                            "url" => Ok(GeneratedField::Url),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = MappedListener;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.MappedListener")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<MappedListener, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut url__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Url => {
                            if url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("url"));
                            }
                            url__ = map_.next_value()?;
                        }
                    }
                }
                Ok(MappedListener {
                    url: url__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.MappedListener", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for MetricSnapshot {
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
        if self.value != 0 {
            len += 1;
        }
        if !self.labels.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.MetricSnapshot", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if self.value != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("value", ToString::to_string(&self.value).as_str())?;
        }
        if !self.labels.is_empty() {
            struct_ser.serialize_field("labels", &self.labels)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for MetricSnapshot {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "name",
            "value",
            "labels",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            Value,
            Labels,
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
                            "value" => Ok(GeneratedField::Value),
                            "labels" => Ok(GeneratedField::Labels),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = MetricSnapshot;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.MetricSnapshot")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<MetricSnapshot, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut value__ = None;
                let mut labels__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Name => {
                            if name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("name"));
                            }
                            name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Labels => {
                            if labels__.is_some() {
                                return Err(serde::de::Error::duplicate_field("labels"));
                            }
                            labels__ = Some(
                                map_.next_value::<std::collections::BTreeMap<_, _>>()?
                            );
                        }
                    }
                }
                Ok(MetricSnapshot {
                    name: name__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                    labels: labels__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.MetricSnapshot", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NodeInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.peer_id != 0 {
            len += 1;
        }
        if !self.ipv4_addr.is_empty() {
            len += 1;
        }
        if !self.proxy_cidrs.is_empty() {
            len += 1;
        }
        if !self.hostname.is_empty() {
            len += 1;
        }
        if self.stun_info.is_some() {
            len += 1;
        }
        if !self.inst_id.is_empty() {
            len += 1;
        }
        if !self.listeners.is_empty() {
            len += 1;
        }
        if !self.config.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if self.feature_flag.is_some() {
            len += 1;
        }
        if self.ip_list.is_some() {
            len += 1;
        }
        if self.public_ipv6_addr.is_some() {
            len += 1;
        }
        if self.ipv6_public_addr_prefix.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.NodeInfo", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if !self.ipv4_addr.is_empty() {
            struct_ser.serialize_field("ipv4_addr", &self.ipv4_addr)?;
        }
        if !self.proxy_cidrs.is_empty() {
            struct_ser.serialize_field("proxy_cidrs", &self.proxy_cidrs)?;
        }
        if !self.hostname.is_empty() {
            struct_ser.serialize_field("hostname", &self.hostname)?;
        }
        if let Some(v) = self.stun_info.as_ref() {
            struct_ser.serialize_field("stun_info", v)?;
        }
        if !self.inst_id.is_empty() {
            struct_ser.serialize_field("inst_id", &self.inst_id)?;
        }
        if !self.listeners.is_empty() {
            struct_ser.serialize_field("listeners", &self.listeners)?;
        }
        if !self.config.is_empty() {
            struct_ser.serialize_field("config", &self.config)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if let Some(v) = self.feature_flag.as_ref() {
            struct_ser.serialize_field("feature_flag", v)?;
        }
        if let Some(v) = self.ip_list.as_ref() {
            struct_ser.serialize_field("ip_list", v)?;
        }
        if let Some(v) = self.public_ipv6_addr.as_ref() {
            struct_ser.serialize_field("public_ipv6_addr", v)?;
        }
        if let Some(v) = self.ipv6_public_addr_prefix.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_prefix", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for NodeInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "ipv4_addr",
            "ipv4Addr",
            "proxy_cidrs",
            "proxyCidrs",
            "hostname",
            "stun_info",
            "stunInfo",
            "inst_id",
            "instId",
            "listeners",
            "config",
            "version",
            "feature_flag",
            "featureFlag",
            "ip_list",
            "ipList",
            "public_ipv6_addr",
            "publicIpv6Addr",
            "ipv6_public_addr_prefix",
            "ipv6PublicAddrPrefix",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            Ipv4Addr,
            ProxyCidrs,
            Hostname,
            StunInfo,
            InstId,
            Listeners,
            Config,
            Version,
            FeatureFlag,
            IpList,
            PublicIpv6Addr,
            Ipv6PublicAddrPrefix,
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
                            "ipv4Addr" | "ipv4_addr" => Ok(GeneratedField::Ipv4Addr),
                            "proxyCidrs" | "proxy_cidrs" => Ok(GeneratedField::ProxyCidrs),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "stunInfo" | "stun_info" => Ok(GeneratedField::StunInfo),
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "listeners" => Ok(GeneratedField::Listeners),
                            "config" => Ok(GeneratedField::Config),
                            "version" => Ok(GeneratedField::Version),
                            "featureFlag" | "feature_flag" => Ok(GeneratedField::FeatureFlag),
                            "ipList" | "ip_list" => Ok(GeneratedField::IpList),
                            "publicIpv6Addr" | "public_ipv6_addr" => Ok(GeneratedField::PublicIpv6Addr),
                            "ipv6PublicAddrPrefix" | "ipv6_public_addr_prefix" => Ok(GeneratedField::Ipv6PublicAddrPrefix),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = NodeInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.NodeInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<NodeInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut ipv4_addr__ = None;
                let mut proxy_cidrs__ = None;
                let mut hostname__ = None;
                let mut stun_info__ = None;
                let mut inst_id__ = None;
                let mut listeners__ = None;
                let mut config__ = None;
                let mut version__ = None;
                let mut feature_flag__ = None;
                let mut ip_list__ = None;
                let mut public_ipv6_addr__ = None;
                let mut ipv6_public_addr_prefix__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Ipv4Addr => {
                            if ipv4_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4Addr"));
                            }
                            ipv4_addr__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ProxyCidrs => {
                            if proxy_cidrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyCidrs"));
                            }
                            proxy_cidrs__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Hostname => {
                            if hostname__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hostname"));
                            }
                            hostname__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StunInfo => {
                            if stun_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stunInfo"));
                            }
                            stun_info__ = map_.next_value()?;
                        }
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Listeners => {
                            if listeners__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listeners"));
                            }
                            listeners__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Config => {
                            if config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("config"));
                            }
                            config__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FeatureFlag => {
                            if feature_flag__.is_some() {
                                return Err(serde::de::Error::duplicate_field("featureFlag"));
                            }
                            feature_flag__ = map_.next_value()?;
                        }
                        GeneratedField::IpList => {
                            if ip_list__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipList"));
                            }
                            ip_list__ = map_.next_value()?;
                        }
                        GeneratedField::PublicIpv6Addr => {
                            if public_ipv6_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIpv6Addr"));
                            }
                            public_ipv6_addr__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6PublicAddrPrefix => {
                            if ipv6_public_addr_prefix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrPrefix"));
                            }
                            ipv6_public_addr_prefix__ = map_.next_value()?;
                        }
                    }
                }
                Ok(NodeInfo {
                    peer_id: peer_id__.unwrap_or_default(),
                    ipv4_addr: ipv4_addr__.unwrap_or_default(),
                    proxy_cidrs: proxy_cidrs__.unwrap_or_default(),
                    hostname: hostname__.unwrap_or_default(),
                    stun_info: stun_info__,
                    inst_id: inst_id__.unwrap_or_default(),
                    listeners: listeners__.unwrap_or_default(),
                    config: config__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    feature_flag: feature_flag__,
                    ip_list: ip_list__,
                    public_ipv6_addr: public_ipv6_addr__,
                    ipv6_public_addr_prefix: ipv6_public_addr_prefix__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.NodeInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnFecStats {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.active {
            len += 1;
        }
        if self.tx_sources != 0 {
            len += 1;
        }
        if self.tx_repairs != 0 {
            len += 1;
        }
        if self.tx_source_bytes != 0 {
            len += 1;
        }
        if self.tx_repair_bytes != 0 {
            len += 1;
        }
        if self.rx_sources != 0 {
            len += 1;
        }
        if self.rx_repairs != 0 {
            len += 1;
        }
        if self.recovered != 0 {
            len += 1;
        }
        if self.duplicates != 0 {
            len += 1;
        }
        if self.invalid_packets != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.PeerConnFecStats", len)?;
        if self.active {
            struct_ser.serialize_field("active", &self.active)?;
        }
        if self.tx_sources != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("tx_sources", ToString::to_string(&self.tx_sources).as_str())?;
        }
        if self.tx_repairs != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("tx_repairs", ToString::to_string(&self.tx_repairs).as_str())?;
        }
        if self.tx_source_bytes != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("tx_source_bytes", ToString::to_string(&self.tx_source_bytes).as_str())?;
        }
        if self.tx_repair_bytes != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("tx_repair_bytes", ToString::to_string(&self.tx_repair_bytes).as_str())?;
        }
        if self.rx_sources != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("rx_sources", ToString::to_string(&self.rx_sources).as_str())?;
        }
        if self.rx_repairs != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("rx_repairs", ToString::to_string(&self.rx_repairs).as_str())?;
        }
        if self.recovered != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("recovered", ToString::to_string(&self.recovered).as_str())?;
        }
        if self.duplicates != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("duplicates", ToString::to_string(&self.duplicates).as_str())?;
        }
        if self.invalid_packets != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("invalid_packets", ToString::to_string(&self.invalid_packets).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnFecStats {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "active",
            "tx_sources",
            "txSources",
            "tx_repairs",
            "txRepairs",
            "tx_source_bytes",
            "txSourceBytes",
            "tx_repair_bytes",
            "txRepairBytes",
            "rx_sources",
            "rxSources",
            "rx_repairs",
            "rxRepairs",
            "recovered",
            "duplicates",
            "invalid_packets",
            "invalidPackets",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Active,
            TxSources,
            TxRepairs,
            TxSourceBytes,
            TxRepairBytes,
            RxSources,
            RxRepairs,
            Recovered,
            Duplicates,
            InvalidPackets,
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
                            "active" => Ok(GeneratedField::Active),
                            "txSources" | "tx_sources" => Ok(GeneratedField::TxSources),
                            "txRepairs" | "tx_repairs" => Ok(GeneratedField::TxRepairs),
                            "txSourceBytes" | "tx_source_bytes" => Ok(GeneratedField::TxSourceBytes),
                            "txRepairBytes" | "tx_repair_bytes" => Ok(GeneratedField::TxRepairBytes),
                            "rxSources" | "rx_sources" => Ok(GeneratedField::RxSources),
                            "rxRepairs" | "rx_repairs" => Ok(GeneratedField::RxRepairs),
                            "recovered" => Ok(GeneratedField::Recovered),
                            "duplicates" => Ok(GeneratedField::Duplicates),
                            "invalidPackets" | "invalid_packets" => Ok(GeneratedField::InvalidPackets),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerConnFecStats;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.PeerConnFecStats")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerConnFecStats, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut active__ = None;
                let mut tx_sources__ = None;
                let mut tx_repairs__ = None;
                let mut tx_source_bytes__ = None;
                let mut tx_repair_bytes__ = None;
                let mut rx_sources__ = None;
                let mut rx_repairs__ = None;
                let mut recovered__ = None;
                let mut duplicates__ = None;
                let mut invalid_packets__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Active => {
                            if active__.is_some() {
                                return Err(serde::de::Error::duplicate_field("active"));
                            }
                            active__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TxSources => {
                            if tx_sources__.is_some() {
                                return Err(serde::de::Error::duplicate_field("txSources"));
                            }
                            tx_sources__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TxRepairs => {
                            if tx_repairs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("txRepairs"));
                            }
                            tx_repairs__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TxSourceBytes => {
                            if tx_source_bytes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("txSourceBytes"));
                            }
                            tx_source_bytes__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TxRepairBytes => {
                            if tx_repair_bytes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("txRepairBytes"));
                            }
                            tx_repair_bytes__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::RxSources => {
                            if rx_sources__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rxSources"));
                            }
                            rx_sources__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::RxRepairs => {
                            if rx_repairs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rxRepairs"));
                            }
                            rx_repairs__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Recovered => {
                            if recovered__.is_some() {
                                return Err(serde::de::Error::duplicate_field("recovered"));
                            }
                            recovered__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Duplicates => {
                            if duplicates__.is_some() {
                                return Err(serde::de::Error::duplicate_field("duplicates"));
                            }
                            duplicates__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::InvalidPackets => {
                            if invalid_packets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("invalidPackets"));
                            }
                            invalid_packets__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(PeerConnFecStats {
                    active: active__.unwrap_or_default(),
                    tx_sources: tx_sources__.unwrap_or_default(),
                    tx_repairs: tx_repairs__.unwrap_or_default(),
                    tx_source_bytes: tx_source_bytes__.unwrap_or_default(),
                    tx_repair_bytes: tx_repair_bytes__.unwrap_or_default(),
                    rx_sources: rx_sources__.unwrap_or_default(),
                    rx_repairs: rx_repairs__.unwrap_or_default(),
                    recovered: recovered__.unwrap_or_default(),
                    duplicates: duplicates__.unwrap_or_default(),
                    invalid_packets: invalid_packets__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.PeerConnFecStats", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.conn_id.is_empty() {
            len += 1;
        }
        if self.my_peer_id != 0 {
            len += 1;
        }
        if self.peer_id != 0 {
            len += 1;
        }
        if !self.features.is_empty() {
            len += 1;
        }
        if self.tunnel.is_some() {
            len += 1;
        }
        if self.stats.is_some() {
            len += 1;
        }
        if self.loss_rate != 0. {
            len += 1;
        }
        if self.is_client {
            len += 1;
        }
        if !self.network_name.is_empty() {
            len += 1;
        }
        if self.is_closed {
            len += 1;
        }
        if !self.noise_local_static_pubkey.is_empty() {
            len += 1;
        }
        if !self.noise_remote_static_pubkey.is_empty() {
            len += 1;
        }
        if self.secure_auth_level != 0 {
            len += 1;
        }
        if self.peer_identity_type != 0 {
            len += 1;
        }
        if self.fec.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.PeerConnInfo", len)?;
        if !self.conn_id.is_empty() {
            struct_ser.serialize_field("conn_id", &self.conn_id)?;
        }
        if self.my_peer_id != 0 {
            struct_ser.serialize_field("my_peer_id", &self.my_peer_id)?;
        }
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if !self.features.is_empty() {
            struct_ser.serialize_field("features", &self.features)?;
        }
        if let Some(v) = self.tunnel.as_ref() {
            struct_ser.serialize_field("tunnel", v)?;
        }
        if let Some(v) = self.stats.as_ref() {
            struct_ser.serialize_field("stats", v)?;
        }
        if self.loss_rate != 0. {
            struct_ser.serialize_field("loss_rate", &self.loss_rate)?;
        }
        if self.is_client {
            struct_ser.serialize_field("is_client", &self.is_client)?;
        }
        if !self.network_name.is_empty() {
            struct_ser.serialize_field("network_name", &self.network_name)?;
        }
        if self.is_closed {
            struct_ser.serialize_field("is_closed", &self.is_closed)?;
        }
        if !self.noise_local_static_pubkey.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("noise_local_static_pubkey", pbjson::private::base64::encode(&self.noise_local_static_pubkey).as_str())?;
        }
        if !self.noise_remote_static_pubkey.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("noise_remote_static_pubkey", pbjson::private::base64::encode(&self.noise_remote_static_pubkey).as_str())?;
        }
        if self.secure_auth_level != 0 {
            let v = super::super::peer_rpc::SecureAuthLevel::try_from(self.secure_auth_level)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.secure_auth_level)))?;
            struct_ser.serialize_field("secure_auth_level", &v)?;
        }
        if self.peer_identity_type != 0 {
            let v = super::super::peer_rpc::PeerIdentityType::try_from(self.peer_identity_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.peer_identity_type)))?;
            struct_ser.serialize_field("peer_identity_type", &v)?;
        }
        if let Some(v) = self.fec.as_ref() {
            struct_ser.serialize_field("fec", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "conn_id",
            "connId",
            "my_peer_id",
            "myPeerId",
            "peer_id",
            "peerId",
            "features",
            "tunnel",
            "stats",
            "loss_rate",
            "lossRate",
            "is_client",
            "isClient",
            "network_name",
            "networkName",
            "is_closed",
            "isClosed",
            "noise_local_static_pubkey",
            "noiseLocalStaticPubkey",
            "noise_remote_static_pubkey",
            "noiseRemoteStaticPubkey",
            "secure_auth_level",
            "secureAuthLevel",
            "peer_identity_type",
            "peerIdentityType",
            "fec",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ConnId,
            MyPeerId,
            PeerId,
            Features,
            Tunnel,
            Stats,
            LossRate,
            IsClient,
            NetworkName,
            IsClosed,
            NoiseLocalStaticPubkey,
            NoiseRemoteStaticPubkey,
            SecureAuthLevel,
            PeerIdentityType,
            Fec,
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
                            "connId" | "conn_id" => Ok(GeneratedField::ConnId),
                            "myPeerId" | "my_peer_id" => Ok(GeneratedField::MyPeerId),
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
                            "features" => Ok(GeneratedField::Features),
                            "tunnel" => Ok(GeneratedField::Tunnel),
                            "stats" => Ok(GeneratedField::Stats),
                            "lossRate" | "loss_rate" => Ok(GeneratedField::LossRate),
                            "isClient" | "is_client" => Ok(GeneratedField::IsClient),
                            "networkName" | "network_name" => Ok(GeneratedField::NetworkName),
                            "isClosed" | "is_closed" => Ok(GeneratedField::IsClosed),
                            "noiseLocalStaticPubkey" | "noise_local_static_pubkey" => Ok(GeneratedField::NoiseLocalStaticPubkey),
                            "noiseRemoteStaticPubkey" | "noise_remote_static_pubkey" => Ok(GeneratedField::NoiseRemoteStaticPubkey),
                            "secureAuthLevel" | "secure_auth_level" => Ok(GeneratedField::SecureAuthLevel),
                            "peerIdentityType" | "peer_identity_type" => Ok(GeneratedField::PeerIdentityType),
                            "fec" => Ok(GeneratedField::Fec),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerConnInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.PeerConnInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerConnInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut conn_id__ = None;
                let mut my_peer_id__ = None;
                let mut peer_id__ = None;
                let mut features__ = None;
                let mut tunnel__ = None;
                let mut stats__ = None;
                let mut loss_rate__ = None;
                let mut is_client__ = None;
                let mut network_name__ = None;
                let mut is_closed__ = None;
                let mut noise_local_static_pubkey__ = None;
                let mut noise_remote_static_pubkey__ = None;
                let mut secure_auth_level__ = None;
                let mut peer_identity_type__ = None;
                let mut fec__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ConnId => {
                            if conn_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connId"));
                            }
                            conn_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MyPeerId => {
                            if my_peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myPeerId"));
                            }
                            my_peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Features => {
                            if features__.is_some() {
                                return Err(serde::de::Error::duplicate_field("features"));
                            }
                            features__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Tunnel => {
                            if tunnel__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tunnel"));
                            }
                            tunnel__ = map_.next_value()?;
                        }
                        GeneratedField::Stats => {
                            if stats__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stats"));
                            }
                            stats__ = map_.next_value()?;
                        }
                        GeneratedField::LossRate => {
                            if loss_rate__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lossRate"));
                            }
                            loss_rate__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::IsClient => {
                            if is_client__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isClient"));
                            }
                            is_client__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NetworkName => {
                            if network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkName"));
                            }
                            network_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::IsClosed => {
                            if is_closed__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isClosed"));
                            }
                            is_closed__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NoiseLocalStaticPubkey => {
                            if noise_local_static_pubkey__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noiseLocalStaticPubkey"));
                            }
                            noise_local_static_pubkey__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::NoiseRemoteStaticPubkey => {
                            if noise_remote_static_pubkey__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noiseRemoteStaticPubkey"));
                            }
                            noise_remote_static_pubkey__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::SecureAuthLevel => {
                            if secure_auth_level__.is_some() {
                                return Err(serde::de::Error::duplicate_field("secureAuthLevel"));
                            }
                            secure_auth_level__ = Some(map_.next_value::<super::super::peer_rpc::SecureAuthLevel>()? as i32);
                        }
                        GeneratedField::PeerIdentityType => {
                            if peer_identity_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerIdentityType"));
                            }
                            peer_identity_type__ = Some(map_.next_value::<super::super::peer_rpc::PeerIdentityType>()? as i32);
                        }
                        GeneratedField::Fec => {
                            if fec__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fec"));
                            }
                            fec__ = map_.next_value()?;
                        }
                    }
                }
                Ok(PeerConnInfo {
                    conn_id: conn_id__.unwrap_or_default(),
                    my_peer_id: my_peer_id__.unwrap_or_default(),
                    peer_id: peer_id__.unwrap_or_default(),
                    features: features__.unwrap_or_default(),
                    tunnel: tunnel__,
                    stats: stats__,
                    loss_rate: loss_rate__.unwrap_or_default(),
                    is_client: is_client__.unwrap_or_default(),
                    network_name: network_name__.unwrap_or_default(),
                    is_closed: is_closed__.unwrap_or_default(),
                    noise_local_static_pubkey: noise_local_static_pubkey__.unwrap_or_default(),
                    noise_remote_static_pubkey: noise_remote_static_pubkey__.unwrap_or_default(),
                    secure_auth_level: secure_auth_level__.unwrap_or_default(),
                    peer_identity_type: peer_identity_type__.unwrap_or_default(),
                    fec: fec__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.PeerConnInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnStats {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.rx_bytes != 0 {
            len += 1;
        }
        if self.tx_bytes != 0 {
            len += 1;
        }
        if self.rx_packets != 0 {
            len += 1;
        }
        if self.tx_packets != 0 {
            len += 1;
        }
        if self.latency_us != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.PeerConnStats", len)?;
        if self.rx_bytes != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("rx_bytes", ToString::to_string(&self.rx_bytes).as_str())?;
        }
        if self.tx_bytes != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("tx_bytes", ToString::to_string(&self.tx_bytes).as_str())?;
        }
        if self.rx_packets != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("rx_packets", ToString::to_string(&self.rx_packets).as_str())?;
        }
        if self.tx_packets != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("tx_packets", ToString::to_string(&self.tx_packets).as_str())?;
        }
        if self.latency_us != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("latency_us", ToString::to_string(&self.latency_us).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnStats {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "rx_bytes",
            "rxBytes",
            "tx_bytes",
            "txBytes",
            "rx_packets",
            "rxPackets",
            "tx_packets",
            "txPackets",
            "latency_us",
            "latencyUs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            RxBytes,
            TxBytes,
            RxPackets,
            TxPackets,
            LatencyUs,
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
                            "rxBytes" | "rx_bytes" => Ok(GeneratedField::RxBytes),
                            "txBytes" | "tx_bytes" => Ok(GeneratedField::TxBytes),
                            "rxPackets" | "rx_packets" => Ok(GeneratedField::RxPackets),
                            "txPackets" | "tx_packets" => Ok(GeneratedField::TxPackets),
                            "latencyUs" | "latency_us" => Ok(GeneratedField::LatencyUs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerConnStats;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.PeerConnStats")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerConnStats, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut rx_bytes__ = None;
                let mut tx_bytes__ = None;
                let mut rx_packets__ = None;
                let mut tx_packets__ = None;
                let mut latency_us__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::RxBytes => {
                            if rx_bytes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rxBytes"));
                            }
                            rx_bytes__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TxBytes => {
                            if tx_bytes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("txBytes"));
                            }
                            tx_bytes__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::RxPackets => {
                            if rx_packets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rxPackets"));
                            }
                            rx_packets__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TxPackets => {
                            if tx_packets__.is_some() {
                                return Err(serde::de::Error::duplicate_field("txPackets"));
                            }
                            tx_packets__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::LatencyUs => {
                            if latency_us__.is_some() {
                                return Err(serde::de::Error::duplicate_field("latencyUs"));
                            }
                            latency_us__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(PeerConnStats {
                    rx_bytes: rx_bytes__.unwrap_or_default(),
                    tx_bytes: tx_bytes__.unwrap_or_default(),
                    rx_packets: rx_packets__.unwrap_or_default(),
                    tx_packets: tx_packets__.unwrap_or_default(),
                    latency_us: latency_us__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.PeerConnStats", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.peer_id != 0 {
            len += 1;
        }
        if !self.conns.is_empty() {
            len += 1;
        }
        if self.default_conn_id.is_some() {
            len += 1;
        }
        if !self.directly_connected_conns.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.PeerInfo", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if !self.conns.is_empty() {
            struct_ser.serialize_field("conns", &self.conns)?;
        }
        if let Some(v) = self.default_conn_id.as_ref() {
            struct_ser.serialize_field("default_conn_id", v)?;
        }
        if !self.directly_connected_conns.is_empty() {
            struct_ser.serialize_field("directly_connected_conns", &self.directly_connected_conns)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "conns",
            "default_conn_id",
            "defaultConnId",
            "directly_connected_conns",
            "directlyConnectedConns",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            Conns,
            DefaultConnId,
            DirectlyConnectedConns,
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
                            "conns" => Ok(GeneratedField::Conns),
                            "defaultConnId" | "default_conn_id" => Ok(GeneratedField::DefaultConnId),
                            "directlyConnectedConns" | "directly_connected_conns" => Ok(GeneratedField::DirectlyConnectedConns),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.PeerInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut conns__ = None;
                let mut default_conn_id__ = None;
                let mut directly_connected_conns__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Conns => {
                            if conns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("conns"));
                            }
                            conns__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DefaultConnId => {
                            if default_conn_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("defaultConnId"));
                            }
                            default_conn_id__ = map_.next_value()?;
                        }
                        GeneratedField::DirectlyConnectedConns => {
                            if directly_connected_conns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("directlyConnectedConns"));
                            }
                            directly_connected_conns__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(PeerInfo {
                    peer_id: peer_id__.unwrap_or_default(),
                    conns: conns__.unwrap_or_default(),
                    default_conn_id: default_conn_id__,
                    directly_connected_conns: directly_connected_conns__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.PeerInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerRoutePair {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.route.is_some() {
            len += 1;
        }
        if self.peer.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.PeerRoutePair", len)?;
        if let Some(v) = self.route.as_ref() {
            struct_ser.serialize_field("route", v)?;
        }
        if let Some(v) = self.peer.as_ref() {
            struct_ser.serialize_field("peer", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerRoutePair {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "route",
            "peer",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Route,
            Peer,
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
                            "route" => Ok(GeneratedField::Route),
                            "peer" => Ok(GeneratedField::Peer),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerRoutePair;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.PeerRoutePair")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerRoutePair, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut route__ = None;
                let mut peer__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Route => {
                            if route__.is_some() {
                                return Err(serde::de::Error::duplicate_field("route"));
                            }
                            route__ = map_.next_value()?;
                        }
                        GeneratedField::Peer => {
                            if peer__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peer"));
                            }
                            peer__ = map_.next_value()?;
                        }
                    }
                }
                Ok(PeerRoutePair {
                    route: route__,
                    peer: peer__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.PeerRoutePair", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PublicIpv6LeaseInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.peer_id != 0 {
            len += 1;
        }
        if !self.inst_id.is_empty() {
            len += 1;
        }
        if self.leased_addr.is_some() {
            len += 1;
        }
        if self.valid_until_unix_seconds != 0 {
            len += 1;
        }
        if self.reused {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.PublicIpv6LeaseInfo", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if !self.inst_id.is_empty() {
            struct_ser.serialize_field("inst_id", &self.inst_id)?;
        }
        if let Some(v) = self.leased_addr.as_ref() {
            struct_ser.serialize_field("leased_addr", v)?;
        }
        if self.valid_until_unix_seconds != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("valid_until_unix_seconds", ToString::to_string(&self.valid_until_unix_seconds).as_str())?;
        }
        if self.reused {
            struct_ser.serialize_field("reused", &self.reused)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PublicIpv6LeaseInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "inst_id",
            "instId",
            "leased_addr",
            "leasedAddr",
            "valid_until_unix_seconds",
            "validUntilUnixSeconds",
            "reused",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            InstId,
            LeasedAddr,
            ValidUntilUnixSeconds,
            Reused,
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
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "leasedAddr" | "leased_addr" => Ok(GeneratedField::LeasedAddr),
                            "validUntilUnixSeconds" | "valid_until_unix_seconds" => Ok(GeneratedField::ValidUntilUnixSeconds),
                            "reused" => Ok(GeneratedField::Reused),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PublicIpv6LeaseInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.PublicIpv6LeaseInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PublicIpv6LeaseInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut inst_id__ = None;
                let mut leased_addr__ = None;
                let mut valid_until_unix_seconds__ = None;
                let mut reused__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LeasedAddr => {
                            if leased_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("leasedAddr"));
                            }
                            leased_addr__ = map_.next_value()?;
                        }
                        GeneratedField::ValidUntilUnixSeconds => {
                            if valid_until_unix_seconds__.is_some() {
                                return Err(serde::de::Error::duplicate_field("validUntilUnixSeconds"));
                            }
                            valid_until_unix_seconds__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Reused => {
                            if reused__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reused"));
                            }
                            reused__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(PublicIpv6LeaseInfo {
                    peer_id: peer_id__.unwrap_or_default(),
                    inst_id: inst_id__.unwrap_or_default(),
                    leased_addr: leased_addr__,
                    valid_until_unix_seconds: valid_until_unix_seconds__.unwrap_or_default(),
                    reused: reused__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.PublicIpv6LeaseInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RevokeCredentialRequest {
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
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.RevokeCredentialRequest", len)?;
        if !self.credential_id.is_empty() {
            struct_ser.serialize_field("credential_id", &self.credential_id)?;
        }
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RevokeCredentialRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "credential_id",
            "credentialId",
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            CredentialId,
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RevokeCredentialRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.RevokeCredentialRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RevokeCredentialRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut credential_id__ = None;
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::CredentialId => {
                            if credential_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialId"));
                            }
                            credential_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RevokeCredentialRequest {
                    credential_id: credential_id__.unwrap_or_default(),
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.RevokeCredentialRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RevokeCredentialResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.success {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.RevokeCredentialResponse", len)?;
        if self.success {
            struct_ser.serialize_field("success", &self.success)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RevokeCredentialResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "success",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Success,
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
                            "success" => Ok(GeneratedField::Success),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RevokeCredentialResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.RevokeCredentialResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RevokeCredentialResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut success__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Success => {
                            if success__.is_some() {
                                return Err(serde::de::Error::duplicate_field("success"));
                            }
                            success__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RevokeCredentialResponse {
                    success: success__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.RevokeCredentialResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Route {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.peer_id != 0 {
            len += 1;
        }
        if self.ipv4_addr.is_some() {
            len += 1;
        }
        if self.next_hop_peer_id != 0 {
            len += 1;
        }
        if self.cost != 0 {
            len += 1;
        }
        if self.path_latency != 0 {
            len += 1;
        }
        if !self.proxy_cidrs.is_empty() {
            len += 1;
        }
        if !self.hostname.is_empty() {
            len += 1;
        }
        if self.stun_info.is_some() {
            len += 1;
        }
        if !self.inst_id.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if self.feature_flag.is_some() {
            len += 1;
        }
        if self.next_hop_peer_id_latency_first.is_some() {
            len += 1;
        }
        if self.cost_latency_first.is_some() {
            len += 1;
        }
        if self.path_latency_latency_first.is_some() {
            len += 1;
        }
        if self.ipv6_addr.is_some() {
            len += 1;
        }
        if self.public_ipv6_addr.is_some() {
            len += 1;
        }
        if self.ipv6_public_addr_prefix.is_some() {
            len += 1;
        }
        if !self.obf_display_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.Route", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.ipv4_addr.as_ref() {
            struct_ser.serialize_field("ipv4_addr", v)?;
        }
        if self.next_hop_peer_id != 0 {
            struct_ser.serialize_field("next_hop_peer_id", &self.next_hop_peer_id)?;
        }
        if self.cost != 0 {
            struct_ser.serialize_field("cost", &self.cost)?;
        }
        if self.path_latency != 0 {
            struct_ser.serialize_field("path_latency", &self.path_latency)?;
        }
        if !self.proxy_cidrs.is_empty() {
            struct_ser.serialize_field("proxy_cidrs", &self.proxy_cidrs)?;
        }
        if !self.hostname.is_empty() {
            struct_ser.serialize_field("hostname", &self.hostname)?;
        }
        if let Some(v) = self.stun_info.as_ref() {
            struct_ser.serialize_field("stun_info", v)?;
        }
        if !self.inst_id.is_empty() {
            struct_ser.serialize_field("inst_id", &self.inst_id)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if let Some(v) = self.feature_flag.as_ref() {
            struct_ser.serialize_field("feature_flag", v)?;
        }
        if let Some(v) = self.next_hop_peer_id_latency_first.as_ref() {
            struct_ser.serialize_field("next_hop_peer_id_latency_first", v)?;
        }
        if let Some(v) = self.cost_latency_first.as_ref() {
            struct_ser.serialize_field("cost_latency_first", v)?;
        }
        if let Some(v) = self.path_latency_latency_first.as_ref() {
            struct_ser.serialize_field("path_latency_latency_first", v)?;
        }
        if let Some(v) = self.ipv6_addr.as_ref() {
            struct_ser.serialize_field("ipv6_addr", v)?;
        }
        if let Some(v) = self.public_ipv6_addr.as_ref() {
            struct_ser.serialize_field("public_ipv6_addr", v)?;
        }
        if let Some(v) = self.ipv6_public_addr_prefix.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_prefix", v)?;
        }
        if !self.obf_display_name.is_empty() {
            struct_ser.serialize_field("obf_display_name", &self.obf_display_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Route {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "ipv4_addr",
            "ipv4Addr",
            "next_hop_peer_id",
            "nextHopPeerId",
            "cost",
            "path_latency",
            "pathLatency",
            "proxy_cidrs",
            "proxyCidrs",
            "hostname",
            "stun_info",
            "stunInfo",
            "inst_id",
            "instId",
            "version",
            "feature_flag",
            "featureFlag",
            "next_hop_peer_id_latency_first",
            "nextHopPeerIdLatencyFirst",
            "cost_latency_first",
            "costLatencyFirst",
            "path_latency_latency_first",
            "pathLatencyLatencyFirst",
            "ipv6_addr",
            "ipv6Addr",
            "public_ipv6_addr",
            "publicIpv6Addr",
            "ipv6_public_addr_prefix",
            "ipv6PublicAddrPrefix",
            "obf_display_name",
            "obfDisplayName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            Ipv4Addr,
            NextHopPeerId,
            Cost,
            PathLatency,
            ProxyCidrs,
            Hostname,
            StunInfo,
            InstId,
            Version,
            FeatureFlag,
            NextHopPeerIdLatencyFirst,
            CostLatencyFirst,
            PathLatencyLatencyFirst,
            Ipv6Addr,
            PublicIpv6Addr,
            Ipv6PublicAddrPrefix,
            ObfDisplayName,
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
                            "ipv4Addr" | "ipv4_addr" => Ok(GeneratedField::Ipv4Addr),
                            "nextHopPeerId" | "next_hop_peer_id" => Ok(GeneratedField::NextHopPeerId),
                            "cost" => Ok(GeneratedField::Cost),
                            "pathLatency" | "path_latency" => Ok(GeneratedField::PathLatency),
                            "proxyCidrs" | "proxy_cidrs" => Ok(GeneratedField::ProxyCidrs),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "stunInfo" | "stun_info" => Ok(GeneratedField::StunInfo),
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "version" => Ok(GeneratedField::Version),
                            "featureFlag" | "feature_flag" => Ok(GeneratedField::FeatureFlag),
                            "nextHopPeerIdLatencyFirst" | "next_hop_peer_id_latency_first" => Ok(GeneratedField::NextHopPeerIdLatencyFirst),
                            "costLatencyFirst" | "cost_latency_first" => Ok(GeneratedField::CostLatencyFirst),
                            "pathLatencyLatencyFirst" | "path_latency_latency_first" => Ok(GeneratedField::PathLatencyLatencyFirst),
                            "ipv6Addr" | "ipv6_addr" => Ok(GeneratedField::Ipv6Addr),
                            "publicIpv6Addr" | "public_ipv6_addr" => Ok(GeneratedField::PublicIpv6Addr),
                            "ipv6PublicAddrPrefix" | "ipv6_public_addr_prefix" => Ok(GeneratedField::Ipv6PublicAddrPrefix),
                            "obfDisplayName" | "obf_display_name" => Ok(GeneratedField::ObfDisplayName),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Route;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.Route")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Route, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut ipv4_addr__ = None;
                let mut next_hop_peer_id__ = None;
                let mut cost__ = None;
                let mut path_latency__ = None;
                let mut proxy_cidrs__ = None;
                let mut hostname__ = None;
                let mut stun_info__ = None;
                let mut inst_id__ = None;
                let mut version__ = None;
                let mut feature_flag__ = None;
                let mut next_hop_peer_id_latency_first__ = None;
                let mut cost_latency_first__ = None;
                let mut path_latency_latency_first__ = None;
                let mut ipv6_addr__ = None;
                let mut public_ipv6_addr__ = None;
                let mut ipv6_public_addr_prefix__ = None;
                let mut obf_display_name__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Ipv4Addr => {
                            if ipv4_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4Addr"));
                            }
                            ipv4_addr__ = map_.next_value()?;
                        }
                        GeneratedField::NextHopPeerId => {
                            if next_hop_peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("nextHopPeerId"));
                            }
                            next_hop_peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Cost => {
                            if cost__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cost"));
                            }
                            cost__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PathLatency => {
                            if path_latency__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pathLatency"));
                            }
                            path_latency__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ProxyCidrs => {
                            if proxy_cidrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyCidrs"));
                            }
                            proxy_cidrs__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Hostname => {
                            if hostname__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hostname"));
                            }
                            hostname__ = Some(map_.next_value()?);
                        }
                        GeneratedField::StunInfo => {
                            if stun_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("stunInfo"));
                            }
                            stun_info__ = map_.next_value()?;
                        }
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FeatureFlag => {
                            if feature_flag__.is_some() {
                                return Err(serde::de::Error::duplicate_field("featureFlag"));
                            }
                            feature_flag__ = map_.next_value()?;
                        }
                        GeneratedField::NextHopPeerIdLatencyFirst => {
                            if next_hop_peer_id_latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("nextHopPeerIdLatencyFirst"));
                            }
                            next_hop_peer_id_latency_first__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::CostLatencyFirst => {
                            if cost_latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("costLatencyFirst"));
                            }
                            cost_latency_first__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::PathLatencyLatencyFirst => {
                            if path_latency_latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pathLatencyLatencyFirst"));
                            }
                            path_latency_latency_first__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Ipv6Addr => {
                            if ipv6_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6Addr"));
                            }
                            ipv6_addr__ = map_.next_value()?;
                        }
                        GeneratedField::PublicIpv6Addr => {
                            if public_ipv6_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIpv6Addr"));
                            }
                            public_ipv6_addr__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6PublicAddrPrefix => {
                            if ipv6_public_addr_prefix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrPrefix"));
                            }
                            ipv6_public_addr_prefix__ = map_.next_value()?;
                        }
                        GeneratedField::ObfDisplayName => {
                            if obf_display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("obfDisplayName"));
                            }
                            obf_display_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Route {
                    peer_id: peer_id__.unwrap_or_default(),
                    ipv4_addr: ipv4_addr__,
                    next_hop_peer_id: next_hop_peer_id__.unwrap_or_default(),
                    cost: cost__.unwrap_or_default(),
                    path_latency: path_latency__.unwrap_or_default(),
                    proxy_cidrs: proxy_cidrs__.unwrap_or_default(),
                    hostname: hostname__.unwrap_or_default(),
                    stun_info: stun_info__,
                    inst_id: inst_id__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    feature_flag: feature_flag__,
                    next_hop_peer_id_latency_first: next_hop_peer_id_latency_first__,
                    cost_latency_first: cost_latency_first__,
                    path_latency_latency_first: path_latency_latency_first__,
                    ipv6_addr: ipv6_addr__,
                    public_ipv6_addr: public_ipv6_addr__,
                    ipv6_public_addr_prefix: ipv6_public_addr_prefix__,
                    obf_display_name: obf_display_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.Route", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ShowNodeInfoRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ShowNodeInfoRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ShowNodeInfoRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ShowNodeInfoRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ShowNodeInfoRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ShowNodeInfoRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ShowNodeInfoRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ShowNodeInfoRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ShowNodeInfoResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.node_info.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.ShowNodeInfoResponse", len)?;
        if let Some(v) = self.node_info.as_ref() {
            struct_ser.serialize_field("node_info", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ShowNodeInfoResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "node_info",
            "nodeInfo",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            NodeInfo,
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
                            "nodeInfo" | "node_info" => Ok(GeneratedField::NodeInfo),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ShowNodeInfoResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.ShowNodeInfoResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ShowNodeInfoResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut node_info__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::NodeInfo => {
                            if node_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("nodeInfo"));
                            }
                            node_info__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ShowNodeInfoResponse {
                    node_info: node_info__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.ShowNodeInfoResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Status {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.code != 0 {
            len += 1;
        }
        if !self.message.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.Status", len)?;
        if self.code != 0 {
            struct_ser.serialize_field("code", &self.code)?;
        }
        if !self.message.is_empty() {
            struct_ser.serialize_field("message", &self.message)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Status {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "code",
            "message",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Code,
            Message,
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
                            "code" => Ok(GeneratedField::Code),
                            "message" => Ok(GeneratedField::Message),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Status;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.Status")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Status, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut code__ = None;
                let mut message__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Code => {
                            if code__.is_some() {
                                return Err(serde::de::Error::duplicate_field("code"));
                            }
                            code__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Message => {
                            if message__.is_some() {
                                return Err(serde::de::Error::duplicate_field("message"));
                            }
                            message__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Status {
                    code: code__.unwrap_or_default(),
                    message: message__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.Status", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TcpProxyEntry {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.src.is_some() {
            len += 1;
        }
        if self.dst.is_some() {
            len += 1;
        }
        if self.start_time != 0 {
            len += 1;
        }
        if self.state != 0 {
            len += 1;
        }
        if self.transport_type != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.TcpProxyEntry", len)?;
        if let Some(v) = self.src.as_ref() {
            struct_ser.serialize_field("src", v)?;
        }
        if let Some(v) = self.dst.as_ref() {
            struct_ser.serialize_field("dst", v)?;
        }
        if self.start_time != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("start_time", ToString::to_string(&self.start_time).as_str())?;
        }
        if self.state != 0 {
            let v = TcpProxyEntryState::try_from(self.state)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.state)))?;
            struct_ser.serialize_field("state", &v)?;
        }
        if self.transport_type != 0 {
            let v = TcpProxyEntryTransportType::try_from(self.transport_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.transport_type)))?;
            struct_ser.serialize_field("transport_type", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TcpProxyEntry {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "src",
            "dst",
            "start_time",
            "startTime",
            "state",
            "transport_type",
            "transportType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Src,
            Dst,
            StartTime,
            State,
            TransportType,
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
                            "src" => Ok(GeneratedField::Src),
                            "dst" => Ok(GeneratedField::Dst),
                            "startTime" | "start_time" => Ok(GeneratedField::StartTime),
                            "state" => Ok(GeneratedField::State),
                            "transportType" | "transport_type" => Ok(GeneratedField::TransportType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TcpProxyEntry;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.TcpProxyEntry")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TcpProxyEntry, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut src__ = None;
                let mut dst__ = None;
                let mut start_time__ = None;
                let mut state__ = None;
                let mut transport_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Src => {
                            if src__.is_some() {
                                return Err(serde::de::Error::duplicate_field("src"));
                            }
                            src__ = map_.next_value()?;
                        }
                        GeneratedField::Dst => {
                            if dst__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dst"));
                            }
                            dst__ = map_.next_value()?;
                        }
                        GeneratedField::StartTime => {
                            if start_time__.is_some() {
                                return Err(serde::de::Error::duplicate_field("startTime"));
                            }
                            start_time__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::State => {
                            if state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("state"));
                            }
                            state__ = Some(map_.next_value::<TcpProxyEntryState>()? as i32);
                        }
                        GeneratedField::TransportType => {
                            if transport_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transportType"));
                            }
                            transport_type__ = Some(map_.next_value::<TcpProxyEntryTransportType>()? as i32);
                        }
                    }
                }
                Ok(TcpProxyEntry {
                    src: src__,
                    dst: dst__,
                    start_time: start_time__.unwrap_or_default(),
                    state: state__.unwrap_or_default(),
                    transport_type: transport_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.TcpProxyEntry", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TcpProxyEntryState {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unknown => "Unknown",
            Self::SynReceived => "SynReceived",
            Self::ConnectingDst => "ConnectingDst",
            Self::Connected => "Connected",
            Self::Closed => "Closed",
            Self::ClosingSrc => "ClosingSrc",
            Self::ClosingDst => "ClosingDst",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for TcpProxyEntryState {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Unknown",
            "SynReceived",
            "ConnectingDst",
            "Connected",
            "Closed",
            "ClosingSrc",
            "ClosingDst",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = TcpProxyEntryState;

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
                    "Unknown" => Ok(TcpProxyEntryState::Unknown),
                    "SynReceived" => Ok(TcpProxyEntryState::SynReceived),
                    "ConnectingDst" => Ok(TcpProxyEntryState::ConnectingDst),
                    "Connected" => Ok(TcpProxyEntryState::Connected),
                    "Closed" => Ok(TcpProxyEntryState::Closed),
                    "ClosingSrc" => Ok(TcpProxyEntryState::ClosingSrc),
                    "ClosingDst" => Ok(TcpProxyEntryState::ClosingDst),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for TcpProxyEntryTransportType {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Tcp => "TCP",
            Self::Kcp => "KCP",
            Self::Quic => "QUIC",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for TcpProxyEntryTransportType {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "TCP",
            "KCP",
            "QUIC",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = TcpProxyEntryTransportType;

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
                    "TCP" => Ok(TcpProxyEntryTransportType::Tcp),
                    "KCP" => Ok(TcpProxyEntryTransportType::Kcp),
                    "QUIC" => Ok(TcpProxyEntryTransportType::Quic),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for TrustedKeyInfoPb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.pubkey.is_empty() {
            len += 1;
        }
        if self.source != 0 {
            len += 1;
        }
        if self.expiry_unix.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.TrustedKeyInfoPb", len)?;
        if !self.pubkey.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("pubkey", pbjson::private::base64::encode(&self.pubkey).as_str())?;
        }
        if self.source != 0 {
            let v = TrustedKeySourcePb::try_from(self.source)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.source)))?;
            struct_ser.serialize_field("source", &v)?;
        }
        if let Some(v) = self.expiry_unix.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("expiry_unix", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TrustedKeyInfoPb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "pubkey",
            "source",
            "expiry_unix",
            "expiryUnix",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Pubkey,
            Source,
            ExpiryUnix,
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
                            "pubkey" => Ok(GeneratedField::Pubkey),
                            "source" => Ok(GeneratedField::Source),
                            "expiryUnix" | "expiry_unix" => Ok(GeneratedField::ExpiryUnix),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TrustedKeyInfoPb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.TrustedKeyInfoPb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TrustedKeyInfoPb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut pubkey__ = None;
                let mut source__ = None;
                let mut expiry_unix__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Pubkey => {
                            if pubkey__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pubkey"));
                            }
                            pubkey__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Source => {
                            if source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("source"));
                            }
                            source__ = Some(map_.next_value::<TrustedKeySourcePb>()? as i32);
                        }
                        GeneratedField::ExpiryUnix => {
                            if expiry_unix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("expiryUnix"));
                            }
                            expiry_unix__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(TrustedKeyInfoPb {
                    pubkey: pubkey__.unwrap_or_default(),
                    source: source__.unwrap_or_default(),
                    expiry_unix: expiry_unix__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.TrustedKeyInfoPb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TrustedKeySourcePb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "TRUSTED_KEY_SOURCE_PB_UNSPECIFIED",
            Self::OspfNode => "TRUSTED_KEY_SOURCE_PB_OSPF_NODE",
            Self::OspfCredential => "TRUSTED_KEY_SOURCE_PB_OSPF_CREDENTIAL",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for TrustedKeySourcePb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "TRUSTED_KEY_SOURCE_PB_UNSPECIFIED",
            "TRUSTED_KEY_SOURCE_PB_OSPF_NODE",
            "TRUSTED_KEY_SOURCE_PB_OSPF_CREDENTIAL",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = TrustedKeySourcePb;

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
                    "TRUSTED_KEY_SOURCE_PB_UNSPECIFIED" => Ok(TrustedKeySourcePb::Unspecified),
                    "TRUSTED_KEY_SOURCE_PB_OSPF_NODE" => Ok(TrustedKeySourcePb::OspfNode),
                    "TRUSTED_KEY_SOURCE_PB_OSPF_CREDENTIAL" => Ok(TrustedKeySourcePb::OspfCredential),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for UpsertCredentialRequest {
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
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.UpsertCredentialRequest", len)?;
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
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpsertCredentialRequest {
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
            "instance",
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
            Instance,
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
                            "instance" => Ok(GeneratedField::Instance),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpsertCredentialRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.UpsertCredentialRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpsertCredentialRequest, V::Error>
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
                let mut instance__ = None;
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
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(UpsertCredentialRequest {
                    credential_id: credential_id__.unwrap_or_default(),
                    credential_secret: credential_secret__.unwrap_or_default(),
                    groups: groups__.unwrap_or_default(),
                    allow_relay: allow_relay__.unwrap_or_default(),
                    allowed_proxy_cidrs: allowed_proxy_cidrs__.unwrap_or_default(),
                    expiry_unix: expiry_unix__.unwrap_or_default(),
                    reusable: reusable__,
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.UpsertCredentialRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UpsertCredentialResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.changed {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.UpsertCredentialResponse", len)?;
        if self.changed {
            struct_ser.serialize_field("changed", &self.changed)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UpsertCredentialResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "changed",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Changed,
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
                            "changed" => Ok(GeneratedField::Changed),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = UpsertCredentialResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.UpsertCredentialResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UpsertCredentialResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut changed__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Changed => {
                            if changed__.is_some() {
                                return Err(serde::de::Error::duplicate_field("changed"));
                            }
                            changed__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(UpsertCredentialResponse {
                    changed: changed__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.instance.UpsertCredentialResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for VpnPortalClientInfo {
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
        if self.state != 0 {
            len += 1;
        }
        if self.peer_id.is_some() {
            len += 1;
        }
        if self.endpoint.is_some() {
            len += 1;
        }
        if self.tunnel_ip.is_some() {
            len += 1;
        }
        if !self.client_config.is_empty() {
            len += 1;
        }
        if self.error.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.VpnPortalClientInfo", len)?;
        if !self.name.is_empty() {
            struct_ser.serialize_field("name", &self.name)?;
        }
        if !self.virtual_ip.is_empty() {
            struct_ser.serialize_field("virtual_ip", &self.virtual_ip)?;
        }
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        if self.state != 0 {
            let v = VpnPortalClientState::try_from(self.state)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.state)))?;
            struct_ser.serialize_field("state", &v)?;
        }
        if let Some(v) = self.peer_id.as_ref() {
            struct_ser.serialize_field("peer_id", v)?;
        }
        if let Some(v) = self.endpoint.as_ref() {
            struct_ser.serialize_field("endpoint", v)?;
        }
        if let Some(v) = self.tunnel_ip.as_ref() {
            struct_ser.serialize_field("tunnel_ip", v)?;
        }
        if !self.client_config.is_empty() {
            struct_ser.serialize_field("client_config", &self.client_config)?;
        }
        if let Some(v) = self.error.as_ref() {
            struct_ser.serialize_field("error", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for VpnPortalClientInfo {
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
            "state",
            "peer_id",
            "peerId",
            "endpoint",
            "tunnel_ip",
            "tunnelIp",
            "client_config",
            "clientConfig",
            "error",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Name,
            VirtualIp,
            Groups,
            State,
            PeerId,
            Endpoint,
            TunnelIp,
            ClientConfig,
            Error,
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
                            "state" => Ok(GeneratedField::State),
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
                            "endpoint" => Ok(GeneratedField::Endpoint),
                            "tunnelIp" | "tunnel_ip" => Ok(GeneratedField::TunnelIp),
                            "clientConfig" | "client_config" => Ok(GeneratedField::ClientConfig),
                            "error" => Ok(GeneratedField::Error),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = VpnPortalClientInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.VpnPortalClientInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<VpnPortalClientInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut name__ = None;
                let mut virtual_ip__ = None;
                let mut groups__ = None;
                let mut state__ = None;
                let mut peer_id__ = None;
                let mut endpoint__ = None;
                let mut tunnel_ip__ = None;
                let mut client_config__ = None;
                let mut error__ = None;
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
                        GeneratedField::State => {
                            if state__.is_some() {
                                return Err(serde::de::Error::duplicate_field("state"));
                            }
                            state__ = Some(map_.next_value::<VpnPortalClientState>()? as i32);
                        }
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Endpoint => {
                            if endpoint__.is_some() {
                                return Err(serde::de::Error::duplicate_field("endpoint"));
                            }
                            endpoint__ = map_.next_value()?;
                        }
                        GeneratedField::TunnelIp => {
                            if tunnel_ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tunnelIp"));
                            }
                            tunnel_ip__ = map_.next_value()?;
                        }
                        GeneratedField::ClientConfig => {
                            if client_config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientConfig"));
                            }
                            client_config__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = map_.next_value()?;
                        }
                    }
                }
                Ok(VpnPortalClientInfo {
                    name: name__.unwrap_or_default(),
                    virtual_ip: virtual_ip__.unwrap_or_default(),
                    groups: groups__.unwrap_or_default(),
                    state: state__.unwrap_or_default(),
                    peer_id: peer_id__,
                    endpoint: endpoint__,
                    tunnel_ip: tunnel_ip__,
                    client_config: client_config__.unwrap_or_default(),
                    error: error__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.VpnPortalClientInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for VpnPortalClientState {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unspecified => "VPN_PORTAL_CLIENT_STATE_UNSPECIFIED",
            Self::Offline => "VPN_PORTAL_CLIENT_STATE_OFFLINE",
            Self::Connecting => "VPN_PORTAL_CLIENT_STATE_CONNECTING",
            Self::Online => "VPN_PORTAL_CLIENT_STATE_ONLINE",
            Self::Error => "VPN_PORTAL_CLIENT_STATE_ERROR",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for VpnPortalClientState {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "VPN_PORTAL_CLIENT_STATE_UNSPECIFIED",
            "VPN_PORTAL_CLIENT_STATE_OFFLINE",
            "VPN_PORTAL_CLIENT_STATE_CONNECTING",
            "VPN_PORTAL_CLIENT_STATE_ONLINE",
            "VPN_PORTAL_CLIENT_STATE_ERROR",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = VpnPortalClientState;

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
                    "VPN_PORTAL_CLIENT_STATE_UNSPECIFIED" => Ok(VpnPortalClientState::Unspecified),
                    "VPN_PORTAL_CLIENT_STATE_OFFLINE" => Ok(VpnPortalClientState::Offline),
                    "VPN_PORTAL_CLIENT_STATE_CONNECTING" => Ok(VpnPortalClientState::Connecting),
                    "VPN_PORTAL_CLIENT_STATE_ONLINE" => Ok(VpnPortalClientState::Online),
                    "VPN_PORTAL_CLIENT_STATE_ERROR" => Ok(VpnPortalClientState::Error),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for VpnPortalInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.vpn_type.is_empty() {
            len += 1;
        }
        if !self.client_config.is_empty() {
            len += 1;
        }
        if !self.connected_clients.is_empty() {
            len += 1;
        }
        if !self.clients.is_empty() {
            len += 1;
        }
        if self.listener.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.instance.VpnPortalInfo", len)?;
        if !self.vpn_type.is_empty() {
            struct_ser.serialize_field("vpn_type", &self.vpn_type)?;
        }
        if !self.client_config.is_empty() {
            struct_ser.serialize_field("client_config", &self.client_config)?;
        }
        if !self.connected_clients.is_empty() {
            struct_ser.serialize_field("connected_clients", &self.connected_clients)?;
        }
        if !self.clients.is_empty() {
            struct_ser.serialize_field("clients", &self.clients)?;
        }
        if let Some(v) = self.listener.as_ref() {
            struct_ser.serialize_field("listener", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for VpnPortalInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "vpn_type",
            "vpnType",
            "client_config",
            "clientConfig",
            "connected_clients",
            "connectedClients",
            "clients",
            "listener",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            VpnType,
            ClientConfig,
            ConnectedClients,
            Clients,
            Listener,
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
                            "vpnType" | "vpn_type" => Ok(GeneratedField::VpnType),
                            "clientConfig" | "client_config" => Ok(GeneratedField::ClientConfig),
                            "connectedClients" | "connected_clients" => Ok(GeneratedField::ConnectedClients),
                            "clients" => Ok(GeneratedField::Clients),
                            "listener" => Ok(GeneratedField::Listener),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = VpnPortalInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.instance.VpnPortalInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<VpnPortalInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut vpn_type__ = None;
                let mut client_config__ = None;
                let mut connected_clients__ = None;
                let mut clients__ = None;
                let mut listener__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::VpnType => {
                            if vpn_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnType"));
                            }
                            vpn_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ClientConfig => {
                            if client_config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientConfig"));
                            }
                            client_config__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ConnectedClients => {
                            if connected_clients__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectedClients"));
                            }
                            connected_clients__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Clients => {
                            if clients__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clients"));
                            }
                            clients__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Listener => {
                            if listener__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listener"));
                            }
                            listener__ = map_.next_value()?;
                        }
                    }
                }
                Ok(VpnPortalInfo {
                    vpn_type: vpn_type__.unwrap_or_default(),
                    client_config: client_config__.unwrap_or_default(),
                    connected_clients: connected_clients__.unwrap_or_default(),
                    clients: clients__.unwrap_or_default(),
                    listener: listener__,
                })
            }
        }
        deserializer.deserialize_struct("api.instance.VpnPortalInfo", FIELDS, GeneratedVisitor)
    }
}
