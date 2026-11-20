impl serde::Serialize for AcquireIpv6PublicAddrLeaseRequest {
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
        if self.inst_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.AcquireIpv6PublicAddrLeaseRequest", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AcquireIpv6PublicAddrLeaseRequest {
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
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
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
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
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
            type Value = AcquireIpv6PublicAddrLeaseRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.AcquireIpv6PublicAddrLeaseRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AcquireIpv6PublicAddrLeaseRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut inst_id__ = None;
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
                            inst_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(AcquireIpv6PublicAddrLeaseRequest {
                    peer_id: peer_id__.unwrap_or_default(),
                    inst_id: inst_id__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.AcquireIpv6PublicAddrLeaseRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for DirectConnectedPeerInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.latency_ms != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.DirectConnectedPeerInfo", len)?;
        if self.latency_ms != 0 {
            struct_ser.serialize_field("latency_ms", &self.latency_ms)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DirectConnectedPeerInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "latency_ms",
            "latencyMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            LatencyMs,
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
                            "latencyMs" | "latency_ms" => Ok(GeneratedField::LatencyMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DirectConnectedPeerInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.DirectConnectedPeerInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DirectConnectedPeerInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut latency_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::LatencyMs => {
                            if latency_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("latencyMs"));
                            }
                            latency_ms__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(DirectConnectedPeerInfo {
                    latency_ms: latency_ms__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.DirectConnectedPeerInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ForeignNetworkRouteInfoEntry {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.foreign_peer_ids.is_empty() {
            len += 1;
        }
        if self.last_update.is_some() {
            len += 1;
        }
        if self.version != 0 {
            len += 1;
        }
        if !self.network_secret_digest.is_empty() {
            len += 1;
        }
        if self.my_peer_id_for_this_network != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.ForeignNetworkRouteInfoEntry", len)?;
        if !self.foreign_peer_ids.is_empty() {
            struct_ser.serialize_field("foreign_peer_ids", &self.foreign_peer_ids)?;
        }
        if let Some(v) = self.last_update.as_ref() {
            struct_ser.serialize_field("last_update", v)?;
        }
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.network_secret_digest.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("network_secret_digest", pbjson::private::base64::encode(&self.network_secret_digest).as_str())?;
        }
        if self.my_peer_id_for_this_network != 0 {
            struct_ser.serialize_field("my_peer_id_for_this_network", &self.my_peer_id_for_this_network)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ForeignNetworkRouteInfoEntry {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "foreign_peer_ids",
            "foreignPeerIds",
            "last_update",
            "lastUpdate",
            "version",
            "network_secret_digest",
            "networkSecretDigest",
            "my_peer_id_for_this_network",
            "myPeerIdForThisNetwork",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ForeignPeerIds,
            LastUpdate,
            Version,
            NetworkSecretDigest,
            MyPeerIdForThisNetwork,
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
                            "foreignPeerIds" | "foreign_peer_ids" => Ok(GeneratedField::ForeignPeerIds),
                            "lastUpdate" | "last_update" => Ok(GeneratedField::LastUpdate),
                            "version" => Ok(GeneratedField::Version),
                            "networkSecretDigest" | "network_secret_digest" => Ok(GeneratedField::NetworkSecretDigest),
                            "myPeerIdForThisNetwork" | "my_peer_id_for_this_network" => Ok(GeneratedField::MyPeerIdForThisNetwork),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ForeignNetworkRouteInfoEntry;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.ForeignNetworkRouteInfoEntry")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ForeignNetworkRouteInfoEntry, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut foreign_peer_ids__ = None;
                let mut last_update__ = None;
                let mut version__ = None;
                let mut network_secret_digest__ = None;
                let mut my_peer_id_for_this_network__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ForeignPeerIds => {
                            if foreign_peer_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignPeerIds"));
                            }
                            foreign_peer_ids__ = 
                                Some(map_.next_value::<Vec<::pbjson::private::NumberDeserialize<_>>>()?
                                    .into_iter().map(|x| x.0).collect())
                            ;
                        }
                        GeneratedField::LastUpdate => {
                            if last_update__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastUpdate"));
                            }
                            last_update__ = map_.next_value()?;
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
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
                    }
                }
                Ok(ForeignNetworkRouteInfoEntry {
                    foreign_peer_ids: foreign_peer_ids__.unwrap_or_default(),
                    last_update: last_update__,
                    version: version__.unwrap_or_default(),
                    network_secret_digest: network_secret_digest__.unwrap_or_default(),
                    my_peer_id_for_this_network: my_peer_id_for_this_network__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.ForeignNetworkRouteInfoEntry", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ForeignNetworkRouteInfoKey {
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
        if !self.network_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.ForeignNetworkRouteInfoKey", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if !self.network_name.is_empty() {
            struct_ser.serialize_field("network_name", &self.network_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ForeignNetworkRouteInfoKey {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "network_name",
            "networkName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
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
            type Value = ForeignNetworkRouteInfoKey;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.ForeignNetworkRouteInfoKey")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ForeignNetworkRouteInfoKey, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut network_name__ = None;
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
                        GeneratedField::NetworkName => {
                            if network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkName"));
                            }
                            network_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ForeignNetworkRouteInfoKey {
                    peer_id: peer_id__.unwrap_or_default(),
                    network_name: network_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.ForeignNetworkRouteInfoKey", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetGlobalPeerMapRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.digest != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.GetGlobalPeerMapRequest", len)?;
        if self.digest != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("digest", ToString::to_string(&self.digest).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetGlobalPeerMapRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "digest",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Digest,
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
                            "digest" => Ok(GeneratedField::Digest),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetGlobalPeerMapRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.GetGlobalPeerMapRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetGlobalPeerMapRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut digest__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Digest => {
                            if digest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("digest"));
                            }
                            digest__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(GetGlobalPeerMapRequest {
                    digest: digest__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.GetGlobalPeerMapRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetGlobalPeerMapResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.global_peer_map.is_empty() {
            len += 1;
        }
        if self.digest.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.GetGlobalPeerMapResponse", len)?;
        if !self.global_peer_map.is_empty() {
            struct_ser.serialize_field("global_peer_map", &self.global_peer_map)?;
        }
        if let Some(v) = self.digest.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("digest", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetGlobalPeerMapResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "global_peer_map",
            "globalPeerMap",
            "digest",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            GlobalPeerMap,
            Digest,
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
                            "globalPeerMap" | "global_peer_map" => Ok(GeneratedField::GlobalPeerMap),
                            "digest" => Ok(GeneratedField::Digest),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetGlobalPeerMapResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.GetGlobalPeerMapResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetGlobalPeerMapResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut global_peer_map__ = None;
                let mut digest__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::GlobalPeerMap => {
                            if global_peer_map__.is_some() {
                                return Err(serde::de::Error::duplicate_field("globalPeerMap"));
                            }
                            global_peer_map__ = Some(
                                map_.next_value::<std::collections::BTreeMap<::pbjson::private::NumberDeserialize<u32>, _>>()?
                                    .into_iter().map(|(k,v)| (k.0, v)).collect()
                            );
                        }
                        GeneratedField::Digest => {
                            if digest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("digest"));
                            }
                            digest__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(GetGlobalPeerMapResponse {
                    global_peer_map: global_peer_map__.unwrap_or_default(),
                    digest: digest__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.GetGlobalPeerMapResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetIpListRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("peer_rpc.GetIpListRequest", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetIpListRequest {
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
            type Value = GetIpListRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.GetIpListRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetIpListRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(GetIpListRequest {
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.GetIpListRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetIpListResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.public_ipv4.is_some() {
            len += 1;
        }
        if !self.interface_ipv4s.is_empty() {
            len += 1;
        }
        if self.public_ipv6.is_some() {
            len += 1;
        }
        if !self.interface_ipv6s.is_empty() {
            len += 1;
        }
        if !self.listeners.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.GetIpListResponse", len)?;
        if let Some(v) = self.public_ipv4.as_ref() {
            struct_ser.serialize_field("public_ipv4", v)?;
        }
        if !self.interface_ipv4s.is_empty() {
            struct_ser.serialize_field("interface_ipv4s", &self.interface_ipv4s)?;
        }
        if let Some(v) = self.public_ipv6.as_ref() {
            struct_ser.serialize_field("public_ipv6", v)?;
        }
        if !self.interface_ipv6s.is_empty() {
            struct_ser.serialize_field("interface_ipv6s", &self.interface_ipv6s)?;
        }
        if !self.listeners.is_empty() {
            struct_ser.serialize_field("listeners", &self.listeners)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetIpListResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "public_ipv4",
            "publicIpv4",
            "interface_ipv4s",
            "interfaceIpv4s",
            "public_ipv6",
            "publicIpv6",
            "interface_ipv6s",
            "interfaceIpv6s",
            "listeners",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PublicIpv4,
            InterfaceIpv4s,
            PublicIpv6,
            InterfaceIpv6s,
            Listeners,
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
                            "publicIpv4" | "public_ipv4" => Ok(GeneratedField::PublicIpv4),
                            "interfaceIpv4s" | "interface_ipv4s" => Ok(GeneratedField::InterfaceIpv4s),
                            "publicIpv6" | "public_ipv6" => Ok(GeneratedField::PublicIpv6),
                            "interfaceIpv6s" | "interface_ipv6s" => Ok(GeneratedField::InterfaceIpv6s),
                            "listeners" => Ok(GeneratedField::Listeners),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetIpListResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.GetIpListResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetIpListResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut public_ipv4__ = None;
                let mut interface_ipv4s__ = None;
                let mut public_ipv6__ = None;
                let mut interface_ipv6s__ = None;
                let mut listeners__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PublicIpv4 => {
                            if public_ipv4__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIpv4"));
                            }
                            public_ipv4__ = map_.next_value()?;
                        }
                        GeneratedField::InterfaceIpv4s => {
                            if interface_ipv4s__.is_some() {
                                return Err(serde::de::Error::duplicate_field("interfaceIpv4s"));
                            }
                            interface_ipv4s__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PublicIpv6 => {
                            if public_ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIpv6"));
                            }
                            public_ipv6__ = map_.next_value()?;
                        }
                        GeneratedField::InterfaceIpv6s => {
                            if interface_ipv6s__.is_some() {
                                return Err(serde::de::Error::duplicate_field("interfaceIpv6s"));
                            }
                            interface_ipv6s__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Listeners => {
                            if listeners__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listeners"));
                            }
                            listeners__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetIpListResponse {
                    public_ipv4: public_ipv4__,
                    interface_ipv4s: interface_ipv4s__.unwrap_or_default(),
                    public_ipv6: public_ipv6__,
                    interface_ipv6s: interface_ipv6s__.unwrap_or_default(),
                    listeners: listeners__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.GetIpListResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetIpv6PublicAddrLeaseRequest {
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
        if self.inst_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.GetIpv6PublicAddrLeaseRequest", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetIpv6PublicAddrLeaseRequest {
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
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
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
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
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
            type Value = GetIpv6PublicAddrLeaseRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.GetIpv6PublicAddrLeaseRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetIpv6PublicAddrLeaseRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut inst_id__ = None;
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
                            inst_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(GetIpv6PublicAddrLeaseRequest {
                    peer_id: peer_id__.unwrap_or_default(),
                    inst_id: inst_id__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.GetIpv6PublicAddrLeaseRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GlobalPeerMap {
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
        let mut struct_ser = serializer.serialize_struct("peer_rpc.GlobalPeerMap", len)?;
        if !self.map.is_empty() {
            struct_ser.serialize_field("map", &self.map)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GlobalPeerMap {
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
            type Value = GlobalPeerMap;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.GlobalPeerMap")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GlobalPeerMap, V::Error>
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
                                map_.next_value::<std::collections::BTreeMap<::pbjson::private::NumberDeserialize<u32>, _>>()?
                                    .into_iter().map(|(k,v)| (k.0, v)).collect()
                            );
                        }
                    }
                }
                Ok(GlobalPeerMap {
                    map: map__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.GlobalPeerMap", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for HandshakeRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.magic != 0 {
            len += 1;
        }
        if self.my_peer_id != 0 {
            len += 1;
        }
        if self.version != 0 {
            len += 1;
        }
        if !self.features.is_empty() {
            len += 1;
        }
        if !self.network_name.is_empty() {
            len += 1;
        }
        if !self.network_secret_digest.is_empty() {
            len += 1;
        }
        if !self.obf_join_token.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.HandshakeRequest", len)?;
        if self.magic != 0 {
            struct_ser.serialize_field("magic", &self.magic)?;
        }
        if self.my_peer_id != 0 {
            struct_ser.serialize_field("my_peer_id", &self.my_peer_id)?;
        }
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.features.is_empty() {
            struct_ser.serialize_field("features", &self.features)?;
        }
        if !self.network_name.is_empty() {
            struct_ser.serialize_field("network_name", &self.network_name)?;
        }
        if !self.network_secret_digest.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("network_secret_digest", pbjson::private::base64::encode(&self.network_secret_digest).as_str())?;
        }
        if !self.obf_join_token.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("obf_join_token", pbjson::private::base64::encode(&self.obf_join_token).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for HandshakeRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "magic",
            "my_peer_id",
            "myPeerId",
            "version",
            "features",
            "network_name",
            "networkName",
            "network_secret_digest",
            "networkSecretDigest",
            "obf_join_token",
            "obfJoinToken",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Magic,
            MyPeerId,
            Version,
            Features,
            NetworkName,
            NetworkSecretDigest,
            ObfJoinToken,
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
                            "magic" => Ok(GeneratedField::Magic),
                            "myPeerId" | "my_peer_id" => Ok(GeneratedField::MyPeerId),
                            "version" => Ok(GeneratedField::Version),
                            "features" => Ok(GeneratedField::Features),
                            "networkName" | "network_name" => Ok(GeneratedField::NetworkName),
                            "networkSecretDigest" | "network_secret_digest" => Ok(GeneratedField::NetworkSecretDigest),
                            "obfJoinToken" | "obf_join_token" => Ok(GeneratedField::ObfJoinToken),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = HandshakeRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.HandshakeRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<HandshakeRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut magic__ = None;
                let mut my_peer_id__ = None;
                let mut version__ = None;
                let mut features__ = None;
                let mut network_name__ = None;
                let mut network_secret_digest__ = None;
                let mut obf_join_token__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Magic => {
                            if magic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("magic"));
                            }
                            magic__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MyPeerId => {
                            if my_peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myPeerId"));
                            }
                            my_peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Features => {
                            if features__.is_some() {
                                return Err(serde::de::Error::duplicate_field("features"));
                            }
                            features__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NetworkName => {
                            if network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkName"));
                            }
                            network_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NetworkSecretDigest => {
                            if network_secret_digest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkSecretDigest"));
                            }
                            network_secret_digest__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ObfJoinToken => {
                            if obf_join_token__.is_some() {
                                return Err(serde::de::Error::duplicate_field("obfJoinToken"));
                            }
                            obf_join_token__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(HandshakeRequest {
                    magic: magic__.unwrap_or_default(),
                    my_peer_id: my_peer_id__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    features: features__.unwrap_or_default(),
                    network_name: network_name__.unwrap_or_default(),
                    network_secret_digest: network_secret_digest__.unwrap_or_default(),
                    obf_join_token: obf_join_token__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.HandshakeRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Ipv6PublicAddrLeaseReply {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.provider_peer_id != 0 {
            len += 1;
        }
        if self.provider_inst_id.is_some() {
            len += 1;
        }
        if self.provider_prefix.is_some() {
            len += 1;
        }
        if self.leased_addr.is_some() {
            len += 1;
        }
        if self.valid_until.is_some() {
            len += 1;
        }
        if self.reused {
            len += 1;
        }
        if self.error_msg.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.Ipv6PublicAddrLeaseReply", len)?;
        if self.provider_peer_id != 0 {
            struct_ser.serialize_field("provider_peer_id", &self.provider_peer_id)?;
        }
        if let Some(v) = self.provider_inst_id.as_ref() {
            struct_ser.serialize_field("provider_inst_id", v)?;
        }
        if let Some(v) = self.provider_prefix.as_ref() {
            struct_ser.serialize_field("provider_prefix", v)?;
        }
        if let Some(v) = self.leased_addr.as_ref() {
            struct_ser.serialize_field("leased_addr", v)?;
        }
        if let Some(v) = self.valid_until.as_ref() {
            struct_ser.serialize_field("valid_until", v)?;
        }
        if self.reused {
            struct_ser.serialize_field("reused", &self.reused)?;
        }
        if let Some(v) = self.error_msg.as_ref() {
            struct_ser.serialize_field("error_msg", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Ipv6PublicAddrLeaseReply {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "provider_peer_id",
            "providerPeerId",
            "provider_inst_id",
            "providerInstId",
            "provider_prefix",
            "providerPrefix",
            "leased_addr",
            "leasedAddr",
            "valid_until",
            "validUntil",
            "reused",
            "error_msg",
            "errorMsg",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ProviderPeerId,
            ProviderInstId,
            ProviderPrefix,
            LeasedAddr,
            ValidUntil,
            Reused,
            ErrorMsg,
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
                            "providerPeerId" | "provider_peer_id" => Ok(GeneratedField::ProviderPeerId),
                            "providerInstId" | "provider_inst_id" => Ok(GeneratedField::ProviderInstId),
                            "providerPrefix" | "provider_prefix" => Ok(GeneratedField::ProviderPrefix),
                            "leasedAddr" | "leased_addr" => Ok(GeneratedField::LeasedAddr),
                            "validUntil" | "valid_until" => Ok(GeneratedField::ValidUntil),
                            "reused" => Ok(GeneratedField::Reused),
                            "errorMsg" | "error_msg" => Ok(GeneratedField::ErrorMsg),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Ipv6PublicAddrLeaseReply;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.Ipv6PublicAddrLeaseReply")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Ipv6PublicAddrLeaseReply, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut provider_peer_id__ = None;
                let mut provider_inst_id__ = None;
                let mut provider_prefix__ = None;
                let mut leased_addr__ = None;
                let mut valid_until__ = None;
                let mut reused__ = None;
                let mut error_msg__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ProviderPeerId => {
                            if provider_peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("providerPeerId"));
                            }
                            provider_peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ProviderInstId => {
                            if provider_inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("providerInstId"));
                            }
                            provider_inst_id__ = map_.next_value()?;
                        }
                        GeneratedField::ProviderPrefix => {
                            if provider_prefix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("providerPrefix"));
                            }
                            provider_prefix__ = map_.next_value()?;
                        }
                        GeneratedField::LeasedAddr => {
                            if leased_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("leasedAddr"));
                            }
                            leased_addr__ = map_.next_value()?;
                        }
                        GeneratedField::ValidUntil => {
                            if valid_until__.is_some() {
                                return Err(serde::de::Error::duplicate_field("validUntil"));
                            }
                            valid_until__ = map_.next_value()?;
                        }
                        GeneratedField::Reused => {
                            if reused__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reused"));
                            }
                            reused__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ErrorMsg => {
                            if error_msg__.is_some() {
                                return Err(serde::de::Error::duplicate_field("errorMsg"));
                            }
                            error_msg__ = map_.next_value()?;
                        }
                    }
                }
                Ok(Ipv6PublicAddrLeaseReply {
                    provider_peer_id: provider_peer_id__.unwrap_or_default(),
                    provider_inst_id: provider_inst_id__,
                    provider_prefix: provider_prefix__,
                    leased_addr: leased_addr__,
                    valid_until: valid_until__,
                    reused: reused__.unwrap_or_default(),
                    error_msg: error_msg__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.Ipv6PublicAddrLeaseReply", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for KcpConnData {
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
        let mut struct_ser = serializer.serialize_struct("peer_rpc.KcpConnData", len)?;
        if let Some(v) = self.src.as_ref() {
            struct_ser.serialize_field("src", v)?;
        }
        if let Some(v) = self.dst.as_ref() {
            struct_ser.serialize_field("dst", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for KcpConnData {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "src",
            "dst",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Src,
            Dst,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = KcpConnData;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.KcpConnData")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<KcpConnData, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut src__ = None;
                let mut dst__ = None;
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
                    }
                }
                Ok(KcpConnData {
                    src: src__,
                    dst: dst__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.KcpConnData", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnNoiseMsg1Pb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.version != 0 {
            len += 1;
        }
        if !self.a_network_name.is_empty() {
            len += 1;
        }
        if self.a_session_generation.is_some() {
            len += 1;
        }
        if self.a_conn_id.is_some() {
            len += 1;
        }
        if !self.client_encryption_algorithm.is_empty() {
            len += 1;
        }
        if !self.features.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.PeerConnNoiseMsg1Pb", len)?;
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.a_network_name.is_empty() {
            struct_ser.serialize_field("a_network_name", &self.a_network_name)?;
        }
        if let Some(v) = self.a_session_generation.as_ref() {
            struct_ser.serialize_field("a_session_generation", v)?;
        }
        if let Some(v) = self.a_conn_id.as_ref() {
            struct_ser.serialize_field("a_conn_id", v)?;
        }
        if !self.client_encryption_algorithm.is_empty() {
            struct_ser.serialize_field("client_encryption_algorithm", &self.client_encryption_algorithm)?;
        }
        if !self.features.is_empty() {
            struct_ser.serialize_field("features", &self.features)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnNoiseMsg1Pb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "version",
            "a_network_name",
            "aNetworkName",
            "a_session_generation",
            "aSessionGeneration",
            "a_conn_id",
            "aConnId",
            "client_encryption_algorithm",
            "clientEncryptionAlgorithm",
            "features",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Version,
            ANetworkName,
            ASessionGeneration,
            AConnId,
            ClientEncryptionAlgorithm,
            Features,
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
                            "version" => Ok(GeneratedField::Version),
                            "aNetworkName" | "a_network_name" => Ok(GeneratedField::ANetworkName),
                            "aSessionGeneration" | "a_session_generation" => Ok(GeneratedField::ASessionGeneration),
                            "aConnId" | "a_conn_id" => Ok(GeneratedField::AConnId),
                            "clientEncryptionAlgorithm" | "client_encryption_algorithm" => Ok(GeneratedField::ClientEncryptionAlgorithm),
                            "features" => Ok(GeneratedField::Features),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerConnNoiseMsg1Pb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.PeerConnNoiseMsg1Pb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerConnNoiseMsg1Pb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut version__ = None;
                let mut a_network_name__ = None;
                let mut a_session_generation__ = None;
                let mut a_conn_id__ = None;
                let mut client_encryption_algorithm__ = None;
                let mut features__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ANetworkName => {
                            if a_network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aNetworkName"));
                            }
                            a_network_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ASessionGeneration => {
                            if a_session_generation__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aSessionGeneration"));
                            }
                            a_session_generation__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::AConnId => {
                            if a_conn_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aConnId"));
                            }
                            a_conn_id__ = map_.next_value()?;
                        }
                        GeneratedField::ClientEncryptionAlgorithm => {
                            if client_encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientEncryptionAlgorithm"));
                            }
                            client_encryption_algorithm__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Features => {
                            if features__.is_some() {
                                return Err(serde::de::Error::duplicate_field("features"));
                            }
                            features__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(PeerConnNoiseMsg1Pb {
                    version: version__.unwrap_or_default(),
                    a_network_name: a_network_name__.unwrap_or_default(),
                    a_session_generation: a_session_generation__,
                    a_conn_id: a_conn_id__,
                    client_encryption_algorithm: client_encryption_algorithm__.unwrap_or_default(),
                    features: features__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.PeerConnNoiseMsg1Pb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnNoiseMsg2Pb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.b_network_name.is_empty() {
            len += 1;
        }
        if self.role_hint != 0 {
            len += 1;
        }
        if self.action != 0 {
            len += 1;
        }
        if self.b_session_generation != 0 {
            len += 1;
        }
        if self.root_key_32.is_some() {
            len += 1;
        }
        if self.initial_epoch != 0 {
            len += 1;
        }
        if self.b_conn_id.is_some() {
            len += 1;
        }
        if self.a_conn_id_echo.is_some() {
            len += 1;
        }
        if self.secret_proof_32.is_some() {
            len += 1;
        }
        if !self.server_encryption_algorithm.is_empty() {
            len += 1;
        }
        if !self.features.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.PeerConnNoiseMsg2Pb", len)?;
        if !self.b_network_name.is_empty() {
            struct_ser.serialize_field("b_network_name", &self.b_network_name)?;
        }
        if self.role_hint != 0 {
            struct_ser.serialize_field("role_hint", &self.role_hint)?;
        }
        if self.action != 0 {
            let v = PeerConnSessionActionPb::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if self.b_session_generation != 0 {
            struct_ser.serialize_field("b_session_generation", &self.b_session_generation)?;
        }
        if let Some(v) = self.root_key_32.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("root_key_32", pbjson::private::base64::encode(&v).as_str())?;
        }
        if self.initial_epoch != 0 {
            struct_ser.serialize_field("initial_epoch", &self.initial_epoch)?;
        }
        if let Some(v) = self.b_conn_id.as_ref() {
            struct_ser.serialize_field("b_conn_id", v)?;
        }
        if let Some(v) = self.a_conn_id_echo.as_ref() {
            struct_ser.serialize_field("a_conn_id_echo", v)?;
        }
        if let Some(v) = self.secret_proof_32.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("secret_proof_32", pbjson::private::base64::encode(&v).as_str())?;
        }
        if !self.server_encryption_algorithm.is_empty() {
            struct_ser.serialize_field("server_encryption_algorithm", &self.server_encryption_algorithm)?;
        }
        if !self.features.is_empty() {
            struct_ser.serialize_field("features", &self.features)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnNoiseMsg2Pb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "b_network_name",
            "bNetworkName",
            "role_hint",
            "roleHint",
            "action",
            "b_session_generation",
            "bSessionGeneration",
            "root_key_32",
            "rootKey32",
            "initial_epoch",
            "initialEpoch",
            "b_conn_id",
            "bConnId",
            "a_conn_id_echo",
            "aConnIdEcho",
            "secret_proof_32",
            "secretProof32",
            "server_encryption_algorithm",
            "serverEncryptionAlgorithm",
            "features",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            BNetworkName,
            RoleHint,
            Action,
            BSessionGeneration,
            RootKey32,
            InitialEpoch,
            BConnId,
            AConnIdEcho,
            SecretProof32,
            ServerEncryptionAlgorithm,
            Features,
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
                            "bNetworkName" | "b_network_name" => Ok(GeneratedField::BNetworkName),
                            "roleHint" | "role_hint" => Ok(GeneratedField::RoleHint),
                            "action" => Ok(GeneratedField::Action),
                            "bSessionGeneration" | "b_session_generation" => Ok(GeneratedField::BSessionGeneration),
                            "rootKey32" | "root_key_32" => Ok(GeneratedField::RootKey32),
                            "initialEpoch" | "initial_epoch" => Ok(GeneratedField::InitialEpoch),
                            "bConnId" | "b_conn_id" => Ok(GeneratedField::BConnId),
                            "aConnIdEcho" | "a_conn_id_echo" => Ok(GeneratedField::AConnIdEcho),
                            "secretProof32" | "secret_proof_32" => Ok(GeneratedField::SecretProof32),
                            "serverEncryptionAlgorithm" | "server_encryption_algorithm" => Ok(GeneratedField::ServerEncryptionAlgorithm),
                            "features" => Ok(GeneratedField::Features),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerConnNoiseMsg2Pb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.PeerConnNoiseMsg2Pb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerConnNoiseMsg2Pb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut b_network_name__ = None;
                let mut role_hint__ = None;
                let mut action__ = None;
                let mut b_session_generation__ = None;
                let mut root_key_32__ = None;
                let mut initial_epoch__ = None;
                let mut b_conn_id__ = None;
                let mut a_conn_id_echo__ = None;
                let mut secret_proof_32__ = None;
                let mut server_encryption_algorithm__ = None;
                let mut features__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::BNetworkName => {
                            if b_network_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bNetworkName"));
                            }
                            b_network_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RoleHint => {
                            if role_hint__.is_some() {
                                return Err(serde::de::Error::duplicate_field("roleHint"));
                            }
                            role_hint__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<PeerConnSessionActionPb>()? as i32);
                        }
                        GeneratedField::BSessionGeneration => {
                            if b_session_generation__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bSessionGeneration"));
                            }
                            b_session_generation__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::RootKey32 => {
                            if root_key_32__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rootKey32"));
                            }
                            root_key_32__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::BytesDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::InitialEpoch => {
                            if initial_epoch__.is_some() {
                                return Err(serde::de::Error::duplicate_field("initialEpoch"));
                            }
                            initial_epoch__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::BConnId => {
                            if b_conn_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bConnId"));
                            }
                            b_conn_id__ = map_.next_value()?;
                        }
                        GeneratedField::AConnIdEcho => {
                            if a_conn_id_echo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aConnIdEcho"));
                            }
                            a_conn_id_echo__ = map_.next_value()?;
                        }
                        GeneratedField::SecretProof32 => {
                            if secret_proof_32__.is_some() {
                                return Err(serde::de::Error::duplicate_field("secretProof32"));
                            }
                            secret_proof_32__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::BytesDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::ServerEncryptionAlgorithm => {
                            if server_encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("serverEncryptionAlgorithm"));
                            }
                            server_encryption_algorithm__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Features => {
                            if features__.is_some() {
                                return Err(serde::de::Error::duplicate_field("features"));
                            }
                            features__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(PeerConnNoiseMsg2Pb {
                    b_network_name: b_network_name__.unwrap_or_default(),
                    role_hint: role_hint__.unwrap_or_default(),
                    action: action__.unwrap_or_default(),
                    b_session_generation: b_session_generation__.unwrap_or_default(),
                    root_key_32: root_key_32__,
                    initial_epoch: initial_epoch__.unwrap_or_default(),
                    b_conn_id: b_conn_id__,
                    a_conn_id_echo: a_conn_id_echo__,
                    secret_proof_32: secret_proof_32__,
                    server_encryption_algorithm: server_encryption_algorithm__.unwrap_or_default(),
                    features: features__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.PeerConnNoiseMsg2Pb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnNoiseMsg3Pb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.a_conn_id_echo.is_some() {
            len += 1;
        }
        if self.b_conn_id_echo.is_some() {
            len += 1;
        }
        if self.secret_proof_32.is_some() {
            len += 1;
        }
        if !self.secret_digest.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.PeerConnNoiseMsg3Pb", len)?;
        if let Some(v) = self.a_conn_id_echo.as_ref() {
            struct_ser.serialize_field("a_conn_id_echo", v)?;
        }
        if let Some(v) = self.b_conn_id_echo.as_ref() {
            struct_ser.serialize_field("b_conn_id_echo", v)?;
        }
        if let Some(v) = self.secret_proof_32.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("secret_proof_32", pbjson::private::base64::encode(&v).as_str())?;
        }
        if !self.secret_digest.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("secret_digest", pbjson::private::base64::encode(&self.secret_digest).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnNoiseMsg3Pb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "a_conn_id_echo",
            "aConnIdEcho",
            "b_conn_id_echo",
            "bConnIdEcho",
            "secret_proof_32",
            "secretProof32",
            "secret_digest",
            "secretDigest",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            AConnIdEcho,
            BConnIdEcho,
            SecretProof32,
            SecretDigest,
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
                            "aConnIdEcho" | "a_conn_id_echo" => Ok(GeneratedField::AConnIdEcho),
                            "bConnIdEcho" | "b_conn_id_echo" => Ok(GeneratedField::BConnIdEcho),
                            "secretProof32" | "secret_proof_32" => Ok(GeneratedField::SecretProof32),
                            "secretDigest" | "secret_digest" => Ok(GeneratedField::SecretDigest),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerConnNoiseMsg3Pb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.PeerConnNoiseMsg3Pb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerConnNoiseMsg3Pb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut a_conn_id_echo__ = None;
                let mut b_conn_id_echo__ = None;
                let mut secret_proof_32__ = None;
                let mut secret_digest__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::AConnIdEcho => {
                            if a_conn_id_echo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aConnIdEcho"));
                            }
                            a_conn_id_echo__ = map_.next_value()?;
                        }
                        GeneratedField::BConnIdEcho => {
                            if b_conn_id_echo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bConnIdEcho"));
                            }
                            b_conn_id_echo__ = map_.next_value()?;
                        }
                        GeneratedField::SecretProof32 => {
                            if secret_proof_32__.is_some() {
                                return Err(serde::de::Error::duplicate_field("secretProof32"));
                            }
                            secret_proof_32__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::BytesDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::SecretDigest => {
                            if secret_digest__.is_some() {
                                return Err(serde::de::Error::duplicate_field("secretDigest"));
                            }
                            secret_digest__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(PeerConnNoiseMsg3Pb {
                    a_conn_id_echo: a_conn_id_echo__,
                    b_conn_id_echo: b_conn_id_echo__,
                    secret_proof_32: secret_proof_32__,
                    secret_digest: secret_digest__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.PeerConnNoiseMsg3Pb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerConnSessionActionPb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Join => "Join",
            Self::Sync => "Sync",
            Self::Create => "Create",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for PeerConnSessionActionPb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Join",
            "Sync",
            "Create",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = PeerConnSessionActionPb;

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
                    "Join" => Ok(PeerConnSessionActionPb::Join),
                    "Sync" => Ok(PeerConnSessionActionPb::Sync),
                    "Create" => Ok(PeerConnSessionActionPb::Create),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for PeerGroupInfo {
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
        if !self.group_proof.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.PeerGroupInfo", len)?;
        if !self.group_name.is_empty() {
            struct_ser.serialize_field("group_name", &self.group_name)?;
        }
        if !self.group_proof.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("group_proof", pbjson::private::base64::encode(&self.group_proof).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerGroupInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "group_name",
            "groupName",
            "group_proof",
            "groupProof",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            GroupName,
            GroupProof,
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
                            "groupProof" | "group_proof" => Ok(GeneratedField::GroupProof),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerGroupInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.PeerGroupInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerGroupInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut group_name__ = None;
                let mut group_proof__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::GroupName => {
                            if group_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupName"));
                            }
                            group_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::GroupProof => {
                            if group_proof__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groupProof"));
                            }
                            group_proof__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(PeerGroupInfo {
                    group_name: group_name__.unwrap_or_default(),
                    group_proof: group_proof__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.PeerGroupInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerIdVersion {
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
        if self.version != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.PeerIdVersion", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerIdVersion {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "version",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
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
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
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
            type Value = PeerIdVersion;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.PeerIdVersion")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerIdVersion, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut version__ = None;
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
                Ok(PeerIdVersion {
                    peer_id: peer_id__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.PeerIdVersion", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PeerIdentityType {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Admin => "Admin",
            Self::Credential => "Credential",
            Self::SharedNode => "SharedNode",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for PeerIdentityType {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Admin",
            "Credential",
            "SharedNode",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = PeerIdentityType;

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
                    "Admin" => Ok(PeerIdentityType::Admin),
                    "Credential" => Ok(PeerIdentityType::Credential),
                    "SharedNode" => Ok(PeerIdentityType::SharedNode),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for PeerInfoForGlobalMap {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.direct_peers.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.PeerInfoForGlobalMap", len)?;
        if !self.direct_peers.is_empty() {
            struct_ser.serialize_field("direct_peers", &self.direct_peers)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerInfoForGlobalMap {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "direct_peers",
            "directPeers",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DirectPeers,
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
                            "directPeers" | "direct_peers" => Ok(GeneratedField::DirectPeers),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerInfoForGlobalMap;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.PeerInfoForGlobalMap")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerInfoForGlobalMap, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut direct_peers__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DirectPeers => {
                            if direct_peers__.is_some() {
                                return Err(serde::de::Error::duplicate_field("directPeers"));
                            }
                            direct_peers__ = Some(
                                map_.next_value::<std::collections::BTreeMap<::pbjson::private::NumberDeserialize<u32>, _>>()?
                                    .into_iter().map(|(k,v)| (k.0, v)).collect()
                            );
                        }
                    }
                }
                Ok(PeerInfoForGlobalMap {
                    direct_peers: direct_peers__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.PeerInfoForGlobalMap", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RelayNoiseMsg1Pb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.version != 0 {
            len += 1;
        }
        if self.a_session_generation.is_some() {
            len += 1;
        }
        if self.a_conn_id.is_some() {
            len += 1;
        }
        if !self.client_encryption_algorithm.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RelayNoiseMsg1Pb", len)?;
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if let Some(v) = self.a_session_generation.as_ref() {
            struct_ser.serialize_field("a_session_generation", v)?;
        }
        if let Some(v) = self.a_conn_id.as_ref() {
            struct_ser.serialize_field("a_conn_id", v)?;
        }
        if !self.client_encryption_algorithm.is_empty() {
            struct_ser.serialize_field("client_encryption_algorithm", &self.client_encryption_algorithm)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RelayNoiseMsg1Pb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "version",
            "a_session_generation",
            "aSessionGeneration",
            "a_conn_id",
            "aConnId",
            "client_encryption_algorithm",
            "clientEncryptionAlgorithm",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Version,
            ASessionGeneration,
            AConnId,
            ClientEncryptionAlgorithm,
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
                            "version" => Ok(GeneratedField::Version),
                            "aSessionGeneration" | "a_session_generation" => Ok(GeneratedField::ASessionGeneration),
                            "aConnId" | "a_conn_id" => Ok(GeneratedField::AConnId),
                            "clientEncryptionAlgorithm" | "client_encryption_algorithm" => Ok(GeneratedField::ClientEncryptionAlgorithm),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RelayNoiseMsg1Pb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RelayNoiseMsg1Pb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RelayNoiseMsg1Pb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut version__ = None;
                let mut a_session_generation__ = None;
                let mut a_conn_id__ = None;
                let mut client_encryption_algorithm__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ASessionGeneration => {
                            if a_session_generation__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aSessionGeneration"));
                            }
                            a_session_generation__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::AConnId => {
                            if a_conn_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aConnId"));
                            }
                            a_conn_id__ = map_.next_value()?;
                        }
                        GeneratedField::ClientEncryptionAlgorithm => {
                            if client_encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("clientEncryptionAlgorithm"));
                            }
                            client_encryption_algorithm__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RelayNoiseMsg1Pb {
                    version: version__.unwrap_or_default(),
                    a_session_generation: a_session_generation__,
                    a_conn_id: a_conn_id__,
                    client_encryption_algorithm: client_encryption_algorithm__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RelayNoiseMsg1Pb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RelayNoiseMsg2Pb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.action != 0 {
            len += 1;
        }
        if self.b_session_generation != 0 {
            len += 1;
        }
        if self.root_key_32.is_some() {
            len += 1;
        }
        if self.initial_epoch != 0 {
            len += 1;
        }
        if self.b_conn_id.is_some() {
            len += 1;
        }
        if self.a_conn_id_echo.is_some() {
            len += 1;
        }
        if !self.server_encryption_algorithm.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RelayNoiseMsg2Pb", len)?;
        if self.action != 0 {
            let v = PeerConnSessionActionPb::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if self.b_session_generation != 0 {
            struct_ser.serialize_field("b_session_generation", &self.b_session_generation)?;
        }
        if let Some(v) = self.root_key_32.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("root_key_32", pbjson::private::base64::encode(&v).as_str())?;
        }
        if self.initial_epoch != 0 {
            struct_ser.serialize_field("initial_epoch", &self.initial_epoch)?;
        }
        if let Some(v) = self.b_conn_id.as_ref() {
            struct_ser.serialize_field("b_conn_id", v)?;
        }
        if let Some(v) = self.a_conn_id_echo.as_ref() {
            struct_ser.serialize_field("a_conn_id_echo", v)?;
        }
        if !self.server_encryption_algorithm.is_empty() {
            struct_ser.serialize_field("server_encryption_algorithm", &self.server_encryption_algorithm)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RelayNoiseMsg2Pb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "b_session_generation",
            "bSessionGeneration",
            "root_key_32",
            "rootKey32",
            "initial_epoch",
            "initialEpoch",
            "b_conn_id",
            "bConnId",
            "a_conn_id_echo",
            "aConnIdEcho",
            "server_encryption_algorithm",
            "serverEncryptionAlgorithm",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
            BSessionGeneration,
            RootKey32,
            InitialEpoch,
            BConnId,
            AConnIdEcho,
            ServerEncryptionAlgorithm,
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
                            "action" => Ok(GeneratedField::Action),
                            "bSessionGeneration" | "b_session_generation" => Ok(GeneratedField::BSessionGeneration),
                            "rootKey32" | "root_key_32" => Ok(GeneratedField::RootKey32),
                            "initialEpoch" | "initial_epoch" => Ok(GeneratedField::InitialEpoch),
                            "bConnId" | "b_conn_id" => Ok(GeneratedField::BConnId),
                            "aConnIdEcho" | "a_conn_id_echo" => Ok(GeneratedField::AConnIdEcho),
                            "serverEncryptionAlgorithm" | "server_encryption_algorithm" => Ok(GeneratedField::ServerEncryptionAlgorithm),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RelayNoiseMsg2Pb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RelayNoiseMsg2Pb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RelayNoiseMsg2Pb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut b_session_generation__ = None;
                let mut root_key_32__ = None;
                let mut initial_epoch__ = None;
                let mut b_conn_id__ = None;
                let mut a_conn_id_echo__ = None;
                let mut server_encryption_algorithm__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<PeerConnSessionActionPb>()? as i32);
                        }
                        GeneratedField::BSessionGeneration => {
                            if b_session_generation__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bSessionGeneration"));
                            }
                            b_session_generation__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::RootKey32 => {
                            if root_key_32__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rootKey32"));
                            }
                            root_key_32__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::BytesDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::InitialEpoch => {
                            if initial_epoch__.is_some() {
                                return Err(serde::de::Error::duplicate_field("initialEpoch"));
                            }
                            initial_epoch__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::BConnId => {
                            if b_conn_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bConnId"));
                            }
                            b_conn_id__ = map_.next_value()?;
                        }
                        GeneratedField::AConnIdEcho => {
                            if a_conn_id_echo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("aConnIdEcho"));
                            }
                            a_conn_id_echo__ = map_.next_value()?;
                        }
                        GeneratedField::ServerEncryptionAlgorithm => {
                            if server_encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("serverEncryptionAlgorithm"));
                            }
                            server_encryption_algorithm__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RelayNoiseMsg2Pb {
                    action: action__.unwrap_or_default(),
                    b_session_generation: b_session_generation__.unwrap_or_default(),
                    root_key_32: root_key_32__,
                    initial_epoch: initial_epoch__.unwrap_or_default(),
                    b_conn_id: b_conn_id__,
                    a_conn_id_echo: a_conn_id_echo__,
                    server_encryption_algorithm: server_encryption_algorithm__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RelayNoiseMsg2Pb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ReleaseIpv6PublicAddrLeaseRequest {
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
        if self.inst_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.ReleaseIpv6PublicAddrLeaseRequest", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ReleaseIpv6PublicAddrLeaseRequest {
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
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
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
                            "peerId" | "peer_id" => Ok(GeneratedField::PeerId),
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
            type Value = ReleaseIpv6PublicAddrLeaseRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.ReleaseIpv6PublicAddrLeaseRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ReleaseIpv6PublicAddrLeaseRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut inst_id__ = None;
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
                            inst_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ReleaseIpv6PublicAddrLeaseRequest {
                    peer_id: peer_id__.unwrap_or_default(),
                    inst_id: inst_id__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.ReleaseIpv6PublicAddrLeaseRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RenewIpv6PublicAddrLeaseRequest {
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
        if self.inst_id.is_some() {
            len += 1;
        }
        if self.leased_addr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RenewIpv6PublicAddrLeaseRequest", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        if let Some(v) = self.leased_addr.as_ref() {
            struct_ser.serialize_field("leased_addr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RenewIpv6PublicAddrLeaseRequest {
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
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            InstId,
            LeasedAddr,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RenewIpv6PublicAddrLeaseRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RenewIpv6PublicAddrLeaseRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RenewIpv6PublicAddrLeaseRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut inst_id__ = None;
                let mut leased_addr__ = None;
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
                            inst_id__ = map_.next_value()?;
                        }
                        GeneratedField::LeasedAddr => {
                            if leased_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("leasedAddr"));
                            }
                            leased_addr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RenewIpv6PublicAddrLeaseRequest {
                    peer_id: peer_id__.unwrap_or_default(),
                    inst_id: inst_id__,
                    leased_addr: leased_addr__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RenewIpv6PublicAddrLeaseRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ReportPeersRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.my_peer_id != 0 {
            len += 1;
        }
        if self.peer_infos.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.ReportPeersRequest", len)?;
        if self.my_peer_id != 0 {
            struct_ser.serialize_field("my_peer_id", &self.my_peer_id)?;
        }
        if let Some(v) = self.peer_infos.as_ref() {
            struct_ser.serialize_field("peer_infos", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ReportPeersRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "my_peer_id",
            "myPeerId",
            "peer_infos",
            "peerInfos",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            MyPeerId,
            PeerInfos,
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
                            "myPeerId" | "my_peer_id" => Ok(GeneratedField::MyPeerId),
                            "peerInfos" | "peer_infos" => Ok(GeneratedField::PeerInfos),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ReportPeersRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.ReportPeersRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ReportPeersRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut my_peer_id__ = None;
                let mut peer_infos__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::MyPeerId => {
                            if my_peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myPeerId"));
                            }
                            my_peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PeerInfos => {
                            if peer_infos__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerInfos"));
                            }
                            peer_infos__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ReportPeersRequest {
                    my_peer_id: my_peer_id__.unwrap_or_default(),
                    peer_infos: peer_infos__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.ReportPeersRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ReportPeersResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("peer_rpc.ReportPeersResponse", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ReportPeersResponse {
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
            type Value = ReportPeersResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.ReportPeersResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ReportPeersResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(ReportPeersResponse {
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.ReportPeersResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RouteConnBitmap {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.peer_ids.is_empty() {
            len += 1;
        }
        if !self.bitmap.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteConnBitmap", len)?;
        if !self.peer_ids.is_empty() {
            struct_ser.serialize_field("peer_ids", &self.peer_ids)?;
        }
        if !self.bitmap.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("bitmap", pbjson::private::base64::encode(&self.bitmap).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RouteConnBitmap {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_ids",
            "peerIds",
            "bitmap",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerIds,
            Bitmap,
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
                            "peerIds" | "peer_ids" => Ok(GeneratedField::PeerIds),
                            "bitmap" => Ok(GeneratedField::Bitmap),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RouteConnBitmap;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteConnBitmap")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RouteConnBitmap, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_ids__ = None;
                let mut bitmap__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerIds => {
                            if peer_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerIds"));
                            }
                            peer_ids__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Bitmap => {
                            if bitmap__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bitmap"));
                            }
                            bitmap__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(RouteConnBitmap {
                    peer_ids: peer_ids__.unwrap_or_default(),
                    bitmap: bitmap__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteConnBitmap", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RouteConnPeerList {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.peer_conn_infos.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteConnPeerList", len)?;
        if !self.peer_conn_infos.is_empty() {
            struct_ser.serialize_field("peer_conn_infos", &self.peer_conn_infos)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RouteConnPeerList {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_conn_infos",
            "peerConnInfos",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerConnInfos,
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
                            "peerConnInfos" | "peer_conn_infos" => Ok(GeneratedField::PeerConnInfos),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RouteConnPeerList;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteConnPeerList")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RouteConnPeerList, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_conn_infos__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerConnInfos => {
                            if peer_conn_infos__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerConnInfos"));
                            }
                            peer_conn_infos__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RouteConnPeerList {
                    peer_conn_infos: peer_conn_infos__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteConnPeerList", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for route_conn_peer_list::PeerConnInfo {
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
        if !self.connected_peer_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteConnPeerList.PeerConnInfo", len)?;
        if let Some(v) = self.peer_id.as_ref() {
            struct_ser.serialize_field("peer_id", v)?;
        }
        if !self.connected_peer_ids.is_empty() {
            struct_ser.serialize_field("connected_peer_ids", &self.connected_peer_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for route_conn_peer_list::PeerConnInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "connected_peer_ids",
            "connectedPeerIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            ConnectedPeerIds,
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
                            "connectedPeerIds" | "connected_peer_ids" => Ok(GeneratedField::ConnectedPeerIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = route_conn_peer_list::PeerConnInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteConnPeerList.PeerConnInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<route_conn_peer_list::PeerConnInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut connected_peer_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::PeerId => {
                            if peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerId"));
                            }
                            peer_id__ = map_.next_value()?;
                        }
                        GeneratedField::ConnectedPeerIds => {
                            if connected_peer_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectedPeerIds"));
                            }
                            connected_peer_ids__ = 
                                Some(map_.next_value::<Vec<::pbjson::private::NumberDeserialize<_>>>()?
                                    .into_iter().map(|x| x.0).collect())
                            ;
                        }
                    }
                }
                Ok(route_conn_peer_list::PeerConnInfo {
                    peer_id: peer_id__,
                    connected_peer_ids: connected_peer_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteConnPeerList.PeerConnInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RouteForeignNetworkInfos {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.infos.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteForeignNetworkInfos", len)?;
        if !self.infos.is_empty() {
            struct_ser.serialize_field("infos", &self.infos)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RouteForeignNetworkInfos {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "infos",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Infos,
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
                            "infos" => Ok(GeneratedField::Infos),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RouteForeignNetworkInfos;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteForeignNetworkInfos")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RouteForeignNetworkInfos, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut infos__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Infos => {
                            if infos__.is_some() {
                                return Err(serde::de::Error::duplicate_field("infos"));
                            }
                            infos__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RouteForeignNetworkInfos {
                    infos: infos__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteForeignNetworkInfos", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for route_foreign_network_infos::Info {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.key.is_some() {
            len += 1;
        }
        if self.value.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteForeignNetworkInfos.Info", len)?;
        if let Some(v) = self.key.as_ref() {
            struct_ser.serialize_field("key", v)?;
        }
        if let Some(v) = self.value.as_ref() {
            struct_ser.serialize_field("value", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for route_foreign_network_infos::Info {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "key",
            "value",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Key,
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
                            "key" => Ok(GeneratedField::Key),
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
            type Value = route_foreign_network_infos::Info;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteForeignNetworkInfos.Info")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<route_foreign_network_infos::Info, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut key__ = None;
                let mut value__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Key => {
                            if key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("key"));
                            }
                            key__ = map_.next_value()?;
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = map_.next_value()?;
                        }
                    }
                }
                Ok(route_foreign_network_infos::Info {
                    key: key__,
                    value: value__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteForeignNetworkInfos.Info", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RouteForeignNetworkSummary {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.info_map.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteForeignNetworkSummary", len)?;
        if !self.info_map.is_empty() {
            struct_ser.serialize_field("info_map", &self.info_map)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RouteForeignNetworkSummary {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "info_map",
            "infoMap",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            InfoMap,
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
                            "infoMap" | "info_map" => Ok(GeneratedField::InfoMap),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RouteForeignNetworkSummary;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteForeignNetworkSummary")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RouteForeignNetworkSummary, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut info_map__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::InfoMap => {
                            if info_map__.is_some() {
                                return Err(serde::de::Error::duplicate_field("infoMap"));
                            }
                            info_map__ = Some(
                                map_.next_value::<std::collections::BTreeMap<::pbjson::private::NumberDeserialize<u32>, _>>()?
                                    .into_iter().map(|(k,v)| (k.0, v)).collect()
                            );
                        }
                    }
                }
                Ok(RouteForeignNetworkSummary {
                    info_map: info_map__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteForeignNetworkSummary", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for route_foreign_network_summary::Info {
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
        if self.network_count != 0 {
            len += 1;
        }
        if self.peer_count != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RouteForeignNetworkSummary.Info", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if self.network_count != 0 {
            struct_ser.serialize_field("network_count", &self.network_count)?;
        }
        if self.peer_count != 0 {
            struct_ser.serialize_field("peer_count", &self.peer_count)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for route_foreign_network_summary::Info {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "peer_id",
            "peerId",
            "network_count",
            "networkCount",
            "peer_count",
            "peerCount",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            NetworkCount,
            PeerCount,
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
                            "networkCount" | "network_count" => Ok(GeneratedField::NetworkCount),
                            "peerCount" | "peer_count" => Ok(GeneratedField::PeerCount),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = route_foreign_network_summary::Info;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RouteForeignNetworkSummary.Info")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<route_foreign_network_summary::Info, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut network_count__ = None;
                let mut peer_count__ = None;
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
                        GeneratedField::NetworkCount => {
                            if network_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkCount"));
                            }
                            network_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PeerCount => {
                            if peer_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerCount"));
                            }
                            peer_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(route_foreign_network_summary::Info {
                    peer_id: peer_id__.unwrap_or_default(),
                    network_count: network_count__.unwrap_or_default(),
                    peer_count: peer_count__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RouteForeignNetworkSummary.Info", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RoutePeerInfo {
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
        if self.inst_id.is_some() {
            len += 1;
        }
        if self.cost != 0 {
            len += 1;
        }
        if self.ipv4_addr.is_some() {
            len += 1;
        }
        if !self.proxy_cidrs.is_empty() {
            len += 1;
        }
        if self.hostname.is_some() {
            len += 1;
        }
        if self.udp_nat_type != 0 {
            len += 1;
        }
        if self.last_update.is_some() {
            len += 1;
        }
        if self.version != 0 {
            len += 1;
        }
        if !self.easytier_version.is_empty() {
            len += 1;
        }
        if self.feature_flag.is_some() {
            len += 1;
        }
        if self.peer_route_id != 0 {
            len += 1;
        }
        if self.network_length != 0 {
            len += 1;
        }
        if self.quic_port.is_some() {
            len += 1;
        }
        if self.ipv6_addr.is_some() {
            len += 1;
        }
        if !self.groups.is_empty() {
            len += 1;
        }
        if self.tcp_nat_type != 0 {
            len += 1;
        }
        if !self.noise_static_pubkey.is_empty() {
            len += 1;
        }
        if !self.trusted_credential_pubkeys.is_empty() {
            len += 1;
        }
        if self.ipv6_public_addr_prefix.is_some() {
            len += 1;
        }
        if self.ipv6_public_addr_lease.is_some() {
            len += 1;
        }
        if !self.obf_display_name.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RoutePeerInfo", len)?;
        if self.peer_id != 0 {
            struct_ser.serialize_field("peer_id", &self.peer_id)?;
        }
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        if self.cost != 0 {
            struct_ser.serialize_field("cost", &self.cost)?;
        }
        if let Some(v) = self.ipv4_addr.as_ref() {
            struct_ser.serialize_field("ipv4_addr", v)?;
        }
        if !self.proxy_cidrs.is_empty() {
            struct_ser.serialize_field("proxy_cidrs", &self.proxy_cidrs)?;
        }
        if let Some(v) = self.hostname.as_ref() {
            struct_ser.serialize_field("hostname", v)?;
        }
        if self.udp_nat_type != 0 {
            let v = super::common::NatType::try_from(self.udp_nat_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.udp_nat_type)))?;
            struct_ser.serialize_field("udp_nat_type", &v)?;
        }
        if let Some(v) = self.last_update.as_ref() {
            struct_ser.serialize_field("last_update", v)?;
        }
        if self.version != 0 {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.easytier_version.is_empty() {
            struct_ser.serialize_field("easytier_version", &self.easytier_version)?;
        }
        if let Some(v) = self.feature_flag.as_ref() {
            struct_ser.serialize_field("feature_flag", v)?;
        }
        if self.peer_route_id != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("peer_route_id", ToString::to_string(&self.peer_route_id).as_str())?;
        }
        if self.network_length != 0 {
            struct_ser.serialize_field("network_length", &self.network_length)?;
        }
        if let Some(v) = self.quic_port.as_ref() {
            struct_ser.serialize_field("quic_port", v)?;
        }
        if let Some(v) = self.ipv6_addr.as_ref() {
            struct_ser.serialize_field("ipv6_addr", v)?;
        }
        if !self.groups.is_empty() {
            struct_ser.serialize_field("groups", &self.groups)?;
        }
        if self.tcp_nat_type != 0 {
            let v = super::common::NatType::try_from(self.tcp_nat_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.tcp_nat_type)))?;
            struct_ser.serialize_field("tcp_nat_type", &v)?;
        }
        if !self.noise_static_pubkey.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("noise_static_pubkey", pbjson::private::base64::encode(&self.noise_static_pubkey).as_str())?;
        }
        if !self.trusted_credential_pubkeys.is_empty() {
            struct_ser.serialize_field("trusted_credential_pubkeys", &self.trusted_credential_pubkeys)?;
        }
        if let Some(v) = self.ipv6_public_addr_prefix.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_prefix", v)?;
        }
        if let Some(v) = self.ipv6_public_addr_lease.as_ref() {
            struct_ser.serialize_field("ipv6_public_addr_lease", v)?;
        }
        if !self.obf_display_name.is_empty() {
            struct_ser.serialize_field("obf_display_name", &self.obf_display_name)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RoutePeerInfo {
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
            "cost",
            "ipv4_addr",
            "ipv4Addr",
            "proxy_cidrs",
            "proxyCidrs",
            "hostname",
            "udp_nat_type",
            "udpNatType",
            "last_update",
            "lastUpdate",
            "version",
            "easytier_version",
            "easytierVersion",
            "feature_flag",
            "featureFlag",
            "peer_route_id",
            "peerRouteId",
            "network_length",
            "networkLength",
            "quic_port",
            "quicPort",
            "ipv6_addr",
            "ipv6Addr",
            "groups",
            "tcp_nat_type",
            "tcpNatType",
            "noise_static_pubkey",
            "noiseStaticPubkey",
            "trusted_credential_pubkeys",
            "trustedCredentialPubkeys",
            "ipv6_public_addr_prefix",
            "ipv6PublicAddrPrefix",
            "ipv6_public_addr_lease",
            "ipv6PublicAddrLease",
            "obf_display_name",
            "obfDisplayName",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            PeerId,
            InstId,
            Cost,
            Ipv4Addr,
            ProxyCidrs,
            Hostname,
            UdpNatType,
            LastUpdate,
            Version,
            EasytierVersion,
            FeatureFlag,
            PeerRouteId,
            NetworkLength,
            QuicPort,
            Ipv6Addr,
            Groups,
            TcpNatType,
            NoiseStaticPubkey,
            TrustedCredentialPubkeys,
            Ipv6PublicAddrPrefix,
            Ipv6PublicAddrLease,
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
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "cost" => Ok(GeneratedField::Cost),
                            "ipv4Addr" | "ipv4_addr" => Ok(GeneratedField::Ipv4Addr),
                            "proxyCidrs" | "proxy_cidrs" => Ok(GeneratedField::ProxyCidrs),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "udpNatType" | "udp_nat_type" => Ok(GeneratedField::UdpNatType),
                            "lastUpdate" | "last_update" => Ok(GeneratedField::LastUpdate),
                            "version" => Ok(GeneratedField::Version),
                            "easytierVersion" | "easytier_version" => Ok(GeneratedField::EasytierVersion),
                            "featureFlag" | "feature_flag" => Ok(GeneratedField::FeatureFlag),
                            "peerRouteId" | "peer_route_id" => Ok(GeneratedField::PeerRouteId),
                            "networkLength" | "network_length" => Ok(GeneratedField::NetworkLength),
                            "quicPort" | "quic_port" => Ok(GeneratedField::QuicPort),
                            "ipv6Addr" | "ipv6_addr" => Ok(GeneratedField::Ipv6Addr),
                            "groups" => Ok(GeneratedField::Groups),
                            "tcpNatType" | "tcp_nat_type" => Ok(GeneratedField::TcpNatType),
                            "noiseStaticPubkey" | "noise_static_pubkey" => Ok(GeneratedField::NoiseStaticPubkey),
                            "trustedCredentialPubkeys" | "trusted_credential_pubkeys" => Ok(GeneratedField::TrustedCredentialPubkeys),
                            "ipv6PublicAddrPrefix" | "ipv6_public_addr_prefix" => Ok(GeneratedField::Ipv6PublicAddrPrefix),
                            "ipv6PublicAddrLease" | "ipv6_public_addr_lease" => Ok(GeneratedField::Ipv6PublicAddrLease),
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
            type Value = RoutePeerInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RoutePeerInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RoutePeerInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut peer_id__ = None;
                let mut inst_id__ = None;
                let mut cost__ = None;
                let mut ipv4_addr__ = None;
                let mut proxy_cidrs__ = None;
                let mut hostname__ = None;
                let mut udp_nat_type__ = None;
                let mut last_update__ = None;
                let mut version__ = None;
                let mut easytier_version__ = None;
                let mut feature_flag__ = None;
                let mut peer_route_id__ = None;
                let mut network_length__ = None;
                let mut quic_port__ = None;
                let mut ipv6_addr__ = None;
                let mut groups__ = None;
                let mut tcp_nat_type__ = None;
                let mut noise_static_pubkey__ = None;
                let mut trusted_credential_pubkeys__ = None;
                let mut ipv6_public_addr_prefix__ = None;
                let mut ipv6_public_addr_lease__ = None;
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
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = map_.next_value()?;
                        }
                        GeneratedField::Cost => {
                            if cost__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cost"));
                            }
                            cost__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Ipv4Addr => {
                            if ipv4_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4Addr"));
                            }
                            ipv4_addr__ = map_.next_value()?;
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
                            hostname__ = map_.next_value()?;
                        }
                        GeneratedField::UdpNatType => {
                            if udp_nat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("udpNatType"));
                            }
                            udp_nat_type__ = Some(map_.next_value::<super::common::NatType>()? as i32);
                        }
                        GeneratedField::LastUpdate => {
                            if last_update__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastUpdate"));
                            }
                            last_update__ = map_.next_value()?;
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::EasytierVersion => {
                            if easytier_version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("easytierVersion"));
                            }
                            easytier_version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FeatureFlag => {
                            if feature_flag__.is_some() {
                                return Err(serde::de::Error::duplicate_field("featureFlag"));
                            }
                            feature_flag__ = map_.next_value()?;
                        }
                        GeneratedField::PeerRouteId => {
                            if peer_route_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerRouteId"));
                            }
                            peer_route_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::NetworkLength => {
                            if network_length__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkLength"));
                            }
                            network_length__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::QuicPort => {
                            if quic_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("quicPort"));
                            }
                            quic_port__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::Ipv6Addr => {
                            if ipv6_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6Addr"));
                            }
                            ipv6_addr__ = map_.next_value()?;
                        }
                        GeneratedField::Groups => {
                            if groups__.is_some() {
                                return Err(serde::de::Error::duplicate_field("groups"));
                            }
                            groups__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TcpNatType => {
                            if tcp_nat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tcpNatType"));
                            }
                            tcp_nat_type__ = Some(map_.next_value::<super::common::NatType>()? as i32);
                        }
                        GeneratedField::NoiseStaticPubkey => {
                            if noise_static_pubkey__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noiseStaticPubkey"));
                            }
                            noise_static_pubkey__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TrustedCredentialPubkeys => {
                            if trusted_credential_pubkeys__.is_some() {
                                return Err(serde::de::Error::duplicate_field("trustedCredentialPubkeys"));
                            }
                            trusted_credential_pubkeys__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Ipv6PublicAddrPrefix => {
                            if ipv6_public_addr_prefix__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrPrefix"));
                            }
                            ipv6_public_addr_prefix__ = map_.next_value()?;
                        }
                        GeneratedField::Ipv6PublicAddrLease => {
                            if ipv6_public_addr_lease__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrLease"));
                            }
                            ipv6_public_addr_lease__ = map_.next_value()?;
                        }
                        GeneratedField::ObfDisplayName => {
                            if obf_display_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("obfDisplayName"));
                            }
                            obf_display_name__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RoutePeerInfo {
                    peer_id: peer_id__.unwrap_or_default(),
                    inst_id: inst_id__,
                    cost: cost__.unwrap_or_default(),
                    ipv4_addr: ipv4_addr__,
                    proxy_cidrs: proxy_cidrs__.unwrap_or_default(),
                    hostname: hostname__,
                    udp_nat_type: udp_nat_type__.unwrap_or_default(),
                    last_update: last_update__,
                    version: version__.unwrap_or_default(),
                    easytier_version: easytier_version__.unwrap_or_default(),
                    feature_flag: feature_flag__,
                    peer_route_id: peer_route_id__.unwrap_or_default(),
                    network_length: network_length__.unwrap_or_default(),
                    quic_port: quic_port__,
                    ipv6_addr: ipv6_addr__,
                    groups: groups__.unwrap_or_default(),
                    tcp_nat_type: tcp_nat_type__.unwrap_or_default(),
                    noise_static_pubkey: noise_static_pubkey__.unwrap_or_default(),
                    trusted_credential_pubkeys: trusted_credential_pubkeys__.unwrap_or_default(),
                    ipv6_public_addr_prefix: ipv6_public_addr_prefix__,
                    ipv6_public_addr_lease: ipv6_public_addr_lease__,
                    obf_display_name: obf_display_name__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RoutePeerInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RoutePeerInfos {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.items.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.RoutePeerInfos", len)?;
        if !self.items.is_empty() {
            struct_ser.serialize_field("items", &self.items)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RoutePeerInfos {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "items",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Items,
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
                            "items" => Ok(GeneratedField::Items),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RoutePeerInfos;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.RoutePeerInfos")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RoutePeerInfos, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut items__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Items => {
                            if items__.is_some() {
                                return Err(serde::de::Error::duplicate_field("items"));
                            }
                            items__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(RoutePeerInfos {
                    items: items__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.RoutePeerInfos", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SecureAuthLevel {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::None => "None",
            Self::EncryptedUnauthenticated => "EncryptedUnauthenticated",
            Self::PeerVerified => "PeerVerified",
            Self::NetworkSecretConfirmed => "NetworkSecretConfirmed",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for SecureAuthLevel {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "None",
            "EncryptedUnauthenticated",
            "PeerVerified",
            "NetworkSecretConfirmed",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = SecureAuthLevel;

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
                    "None" => Ok(SecureAuthLevel::None),
                    "EncryptedUnauthenticated" => Ok(SecureAuthLevel::EncryptedUnauthenticated),
                    "PeerVerified" => Ok(SecureAuthLevel::PeerVerified),
                    "NetworkSecretConfirmed" => Ok(SecureAuthLevel::NetworkSecretConfirmed),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for SelectPunchListenerRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.force_new {
            len += 1;
        }
        if self.prefer_port_mapping {
            len += 1;
        }
        if self.transaction_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SelectPunchListenerRequest", len)?;
        if self.force_new {
            struct_ser.serialize_field("force_new", &self.force_new)?;
        }
        if self.prefer_port_mapping {
            struct_ser.serialize_field("prefer_port_mapping", &self.prefer_port_mapping)?;
        }
        if let Some(v) = self.transaction_id.as_ref() {
            struct_ser.serialize_field("transaction_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SelectPunchListenerRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "force_new",
            "forceNew",
            "prefer_port_mapping",
            "preferPortMapping",
            "transaction_id",
            "transactionId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ForceNew,
            PreferPortMapping,
            TransactionId,
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
                            "forceNew" | "force_new" => Ok(GeneratedField::ForceNew),
                            "preferPortMapping" | "prefer_port_mapping" => Ok(GeneratedField::PreferPortMapping),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SelectPunchListenerRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SelectPunchListenerRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SelectPunchListenerRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut force_new__ = None;
                let mut prefer_port_mapping__ = None;
                let mut transaction_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ForceNew => {
                            if force_new__.is_some() {
                                return Err(serde::de::Error::duplicate_field("forceNew"));
                            }
                            force_new__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PreferPortMapping => {
                            if prefer_port_mapping__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preferPortMapping"));
                            }
                            prefer_port_mapping__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(SelectPunchListenerRequest {
                    force_new: force_new__.unwrap_or_default(),
                    prefer_port_mapping: prefer_port_mapping__.unwrap_or_default(),
                    transaction_id: transaction_id__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SelectPunchListenerRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SelectPunchListenerResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.listener_mapped_addr.is_some() {
            len += 1;
        }
        if self.transaction_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SelectPunchListenerResponse", len)?;
        if let Some(v) = self.listener_mapped_addr.as_ref() {
            struct_ser.serialize_field("listener_mapped_addr", v)?;
        }
        if let Some(v) = self.transaction_id.as_ref() {
            struct_ser.serialize_field("transaction_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SelectPunchListenerResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "listener_mapped_addr",
            "listenerMappedAddr",
            "transaction_id",
            "transactionId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ListenerMappedAddr,
            TransactionId,
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
                            "listenerMappedAddr" | "listener_mapped_addr" => Ok(GeneratedField::ListenerMappedAddr),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SelectPunchListenerResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SelectPunchListenerResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SelectPunchListenerResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut listener_mapped_addr__ = None;
                let mut transaction_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ListenerMappedAddr => {
                            if listener_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerMappedAddr"));
                            }
                            listener_mapped_addr__ = map_.next_value()?;
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(SelectPunchListenerResponse {
                    listener_mapped_addr: listener_mapped_addr__,
                    transaction_id: transaction_id__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SelectPunchListenerResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendPunchPacketBothEasySymRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.udp_socket_count != 0 {
            len += 1;
        }
        if self.public_ip.is_some() {
            len += 1;
        }
        if self.transaction_id != 0 {
            len += 1;
        }
        if self.dst_port_num != 0 {
            len += 1;
        }
        if self.wait_time_ms != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendPunchPacketBothEasySymRequest", len)?;
        if self.udp_socket_count != 0 {
            struct_ser.serialize_field("udp_socket_count", &self.udp_socket_count)?;
        }
        if let Some(v) = self.public_ip.as_ref() {
            struct_ser.serialize_field("public_ip", v)?;
        }
        if self.transaction_id != 0 {
            struct_ser.serialize_field("transaction_id", &self.transaction_id)?;
        }
        if self.dst_port_num != 0 {
            struct_ser.serialize_field("dst_port_num", &self.dst_port_num)?;
        }
        if self.wait_time_ms != 0 {
            struct_ser.serialize_field("wait_time_ms", &self.wait_time_ms)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendPunchPacketBothEasySymRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "udp_socket_count",
            "udpSocketCount",
            "public_ip",
            "publicIp",
            "transaction_id",
            "transactionId",
            "dst_port_num",
            "dstPortNum",
            "wait_time_ms",
            "waitTimeMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            UdpSocketCount,
            PublicIp,
            TransactionId,
            DstPortNum,
            WaitTimeMs,
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
                            "udpSocketCount" | "udp_socket_count" => Ok(GeneratedField::UdpSocketCount),
                            "publicIp" | "public_ip" => Ok(GeneratedField::PublicIp),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            "dstPortNum" | "dst_port_num" => Ok(GeneratedField::DstPortNum),
                            "waitTimeMs" | "wait_time_ms" => Ok(GeneratedField::WaitTimeMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendPunchPacketBothEasySymRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendPunchPacketBothEasySymRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendPunchPacketBothEasySymRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut udp_socket_count__ = None;
                let mut public_ip__ = None;
                let mut transaction_id__ = None;
                let mut dst_port_num__ = None;
                let mut wait_time_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::UdpSocketCount => {
                            if udp_socket_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("udpSocketCount"));
                            }
                            udp_socket_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PublicIp => {
                            if public_ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIp"));
                            }
                            public_ip__ = map_.next_value()?;
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::DstPortNum => {
                            if dst_port_num__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dstPortNum"));
                            }
                            dst_port_num__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::WaitTimeMs => {
                            if wait_time_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("waitTimeMs"));
                            }
                            wait_time_ms__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(SendPunchPacketBothEasySymRequest {
                    udp_socket_count: udp_socket_count__.unwrap_or_default(),
                    public_ip: public_ip__,
                    transaction_id: transaction_id__.unwrap_or_default(),
                    dst_port_num: dst_port_num__.unwrap_or_default(),
                    wait_time_ms: wait_time_ms__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendPunchPacketBothEasySymRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendPunchPacketBothEasySymResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.is_busy {
            len += 1;
        }
        if self.base_mapped_addr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendPunchPacketBothEasySymResponse", len)?;
        if self.is_busy {
            struct_ser.serialize_field("is_busy", &self.is_busy)?;
        }
        if let Some(v) = self.base_mapped_addr.as_ref() {
            struct_ser.serialize_field("base_mapped_addr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendPunchPacketBothEasySymResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "is_busy",
            "isBusy",
            "base_mapped_addr",
            "baseMappedAddr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            IsBusy,
            BaseMappedAddr,
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
                            "isBusy" | "is_busy" => Ok(GeneratedField::IsBusy),
                            "baseMappedAddr" | "base_mapped_addr" => Ok(GeneratedField::BaseMappedAddr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendPunchPacketBothEasySymResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendPunchPacketBothEasySymResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendPunchPacketBothEasySymResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut is_busy__ = None;
                let mut base_mapped_addr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::IsBusy => {
                            if is_busy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isBusy"));
                            }
                            is_busy__ = Some(map_.next_value()?);
                        }
                        GeneratedField::BaseMappedAddr => {
                            if base_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("baseMappedAddr"));
                            }
                            base_mapped_addr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(SendPunchPacketBothEasySymResponse {
                    is_busy: is_busy__.unwrap_or_default(),
                    base_mapped_addr: base_mapped_addr__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendPunchPacketBothEasySymResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendPunchPacketConeRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.listener_mapped_addr.is_some() {
            len += 1;
        }
        if self.dest_addr.is_some() {
            len += 1;
        }
        if self.transaction_id != 0 {
            len += 1;
        }
        if self.packet_count_per_batch != 0 {
            len += 1;
        }
        if self.packet_batch_count != 0 {
            len += 1;
        }
        if self.packet_interval_ms != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendPunchPacketConeRequest", len)?;
        if let Some(v) = self.listener_mapped_addr.as_ref() {
            struct_ser.serialize_field("listener_mapped_addr", v)?;
        }
        if let Some(v) = self.dest_addr.as_ref() {
            struct_ser.serialize_field("dest_addr", v)?;
        }
        if self.transaction_id != 0 {
            struct_ser.serialize_field("transaction_id", &self.transaction_id)?;
        }
        if self.packet_count_per_batch != 0 {
            struct_ser.serialize_field("packet_count_per_batch", &self.packet_count_per_batch)?;
        }
        if self.packet_batch_count != 0 {
            struct_ser.serialize_field("packet_batch_count", &self.packet_batch_count)?;
        }
        if self.packet_interval_ms != 0 {
            struct_ser.serialize_field("packet_interval_ms", &self.packet_interval_ms)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendPunchPacketConeRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "listener_mapped_addr",
            "listenerMappedAddr",
            "dest_addr",
            "destAddr",
            "transaction_id",
            "transactionId",
            "packet_count_per_batch",
            "packetCountPerBatch",
            "packet_batch_count",
            "packetBatchCount",
            "packet_interval_ms",
            "packetIntervalMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ListenerMappedAddr,
            DestAddr,
            TransactionId,
            PacketCountPerBatch,
            PacketBatchCount,
            PacketIntervalMs,
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
                            "listenerMappedAddr" | "listener_mapped_addr" => Ok(GeneratedField::ListenerMappedAddr),
                            "destAddr" | "dest_addr" => Ok(GeneratedField::DestAddr),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            "packetCountPerBatch" | "packet_count_per_batch" => Ok(GeneratedField::PacketCountPerBatch),
                            "packetBatchCount" | "packet_batch_count" => Ok(GeneratedField::PacketBatchCount),
                            "packetIntervalMs" | "packet_interval_ms" => Ok(GeneratedField::PacketIntervalMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendPunchPacketConeRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendPunchPacketConeRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendPunchPacketConeRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut listener_mapped_addr__ = None;
                let mut dest_addr__ = None;
                let mut transaction_id__ = None;
                let mut packet_count_per_batch__ = None;
                let mut packet_batch_count__ = None;
                let mut packet_interval_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ListenerMappedAddr => {
                            if listener_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerMappedAddr"));
                            }
                            listener_mapped_addr__ = map_.next_value()?;
                        }
                        GeneratedField::DestAddr => {
                            if dest_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("destAddr"));
                            }
                            dest_addr__ = map_.next_value()?;
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PacketCountPerBatch => {
                            if packet_count_per_batch__.is_some() {
                                return Err(serde::de::Error::duplicate_field("packetCountPerBatch"));
                            }
                            packet_count_per_batch__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PacketBatchCount => {
                            if packet_batch_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("packetBatchCount"));
                            }
                            packet_batch_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PacketIntervalMs => {
                            if packet_interval_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("packetIntervalMs"));
                            }
                            packet_interval_ms__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(SendPunchPacketConeRequest {
                    listener_mapped_addr: listener_mapped_addr__,
                    dest_addr: dest_addr__,
                    transaction_id: transaction_id__.unwrap_or_default(),
                    packet_count_per_batch: packet_count_per_batch__.unwrap_or_default(),
                    packet_batch_count: packet_batch_count__.unwrap_or_default(),
                    packet_interval_ms: packet_interval_ms__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendPunchPacketConeRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendPunchPacketEasySymRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.listener_mapped_addr.is_some() {
            len += 1;
        }
        if !self.public_ips.is_empty() {
            len += 1;
        }
        if self.transaction_id != 0 {
            len += 1;
        }
        if self.base_port_num != 0 {
            len += 1;
        }
        if self.max_port_num != 0 {
            len += 1;
        }
        if self.is_incremental {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendPunchPacketEasySymRequest", len)?;
        if let Some(v) = self.listener_mapped_addr.as_ref() {
            struct_ser.serialize_field("listener_mapped_addr", v)?;
        }
        if !self.public_ips.is_empty() {
            struct_ser.serialize_field("public_ips", &self.public_ips)?;
        }
        if self.transaction_id != 0 {
            struct_ser.serialize_field("transaction_id", &self.transaction_id)?;
        }
        if self.base_port_num != 0 {
            struct_ser.serialize_field("base_port_num", &self.base_port_num)?;
        }
        if self.max_port_num != 0 {
            struct_ser.serialize_field("max_port_num", &self.max_port_num)?;
        }
        if self.is_incremental {
            struct_ser.serialize_field("is_incremental", &self.is_incremental)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendPunchPacketEasySymRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "listener_mapped_addr",
            "listenerMappedAddr",
            "public_ips",
            "publicIps",
            "transaction_id",
            "transactionId",
            "base_port_num",
            "basePortNum",
            "max_port_num",
            "maxPortNum",
            "is_incremental",
            "isIncremental",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ListenerMappedAddr,
            PublicIps,
            TransactionId,
            BasePortNum,
            MaxPortNum,
            IsIncremental,
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
                            "listenerMappedAddr" | "listener_mapped_addr" => Ok(GeneratedField::ListenerMappedAddr),
                            "publicIps" | "public_ips" => Ok(GeneratedField::PublicIps),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            "basePortNum" | "base_port_num" => Ok(GeneratedField::BasePortNum),
                            "maxPortNum" | "max_port_num" => Ok(GeneratedField::MaxPortNum),
                            "isIncremental" | "is_incremental" => Ok(GeneratedField::IsIncremental),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendPunchPacketEasySymRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendPunchPacketEasySymRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendPunchPacketEasySymRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut listener_mapped_addr__ = None;
                let mut public_ips__ = None;
                let mut transaction_id__ = None;
                let mut base_port_num__ = None;
                let mut max_port_num__ = None;
                let mut is_incremental__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ListenerMappedAddr => {
                            if listener_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerMappedAddr"));
                            }
                            listener_mapped_addr__ = map_.next_value()?;
                        }
                        GeneratedField::PublicIps => {
                            if public_ips__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIps"));
                            }
                            public_ips__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::BasePortNum => {
                            if base_port_num__.is_some() {
                                return Err(serde::de::Error::duplicate_field("basePortNum"));
                            }
                            base_port_num__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MaxPortNum => {
                            if max_port_num__.is_some() {
                                return Err(serde::de::Error::duplicate_field("maxPortNum"));
                            }
                            max_port_num__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::IsIncremental => {
                            if is_incremental__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isIncremental"));
                            }
                            is_incremental__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(SendPunchPacketEasySymRequest {
                    listener_mapped_addr: listener_mapped_addr__,
                    public_ips: public_ips__.unwrap_or_default(),
                    transaction_id: transaction_id__.unwrap_or_default(),
                    base_port_num: base_port_num__.unwrap_or_default(),
                    max_port_num: max_port_num__.unwrap_or_default(),
                    is_incremental: is_incremental__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendPunchPacketEasySymRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendPunchPacketHardSymRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.listener_mapped_addr.is_some() {
            len += 1;
        }
        if !self.public_ips.is_empty() {
            len += 1;
        }
        if self.transaction_id != 0 {
            len += 1;
        }
        if self.port_index != 0 {
            len += 1;
        }
        if self.round != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendPunchPacketHardSymRequest", len)?;
        if let Some(v) = self.listener_mapped_addr.as_ref() {
            struct_ser.serialize_field("listener_mapped_addr", v)?;
        }
        if !self.public_ips.is_empty() {
            struct_ser.serialize_field("public_ips", &self.public_ips)?;
        }
        if self.transaction_id != 0 {
            struct_ser.serialize_field("transaction_id", &self.transaction_id)?;
        }
        if self.port_index != 0 {
            struct_ser.serialize_field("port_index", &self.port_index)?;
        }
        if self.round != 0 {
            struct_ser.serialize_field("round", &self.round)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendPunchPacketHardSymRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "listener_mapped_addr",
            "listenerMappedAddr",
            "public_ips",
            "publicIps",
            "transaction_id",
            "transactionId",
            "port_index",
            "portIndex",
            "round",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ListenerMappedAddr,
            PublicIps,
            TransactionId,
            PortIndex,
            Round,
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
                            "listenerMappedAddr" | "listener_mapped_addr" => Ok(GeneratedField::ListenerMappedAddr),
                            "publicIps" | "public_ips" => Ok(GeneratedField::PublicIps),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            "portIndex" | "port_index" => Ok(GeneratedField::PortIndex),
                            "round" => Ok(GeneratedField::Round),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendPunchPacketHardSymRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendPunchPacketHardSymRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendPunchPacketHardSymRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut listener_mapped_addr__ = None;
                let mut public_ips__ = None;
                let mut transaction_id__ = None;
                let mut port_index__ = None;
                let mut round__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ListenerMappedAddr => {
                            if listener_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerMappedAddr"));
                            }
                            listener_mapped_addr__ = map_.next_value()?;
                        }
                        GeneratedField::PublicIps => {
                            if public_ips__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIps"));
                            }
                            public_ips__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PortIndex => {
                            if port_index__.is_some() {
                                return Err(serde::de::Error::duplicate_field("portIndex"));
                            }
                            port_index__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Round => {
                            if round__.is_some() {
                                return Err(serde::de::Error::duplicate_field("round"));
                            }
                            round__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(SendPunchPacketHardSymRequest {
                    listener_mapped_addr: listener_mapped_addr__,
                    public_ips: public_ips__.unwrap_or_default(),
                    transaction_id: transaction_id__.unwrap_or_default(),
                    port_index: port_index__.unwrap_or_default(),
                    round: round__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendPunchPacketHardSymRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendPunchPacketHardSymResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.next_port_index != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendPunchPacketHardSymResponse", len)?;
        if self.next_port_index != 0 {
            struct_ser.serialize_field("next_port_index", &self.next_port_index)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendPunchPacketHardSymResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "next_port_index",
            "nextPortIndex",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            NextPortIndex,
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
                            "nextPortIndex" | "next_port_index" => Ok(GeneratedField::NextPortIndex),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendPunchPacketHardSymResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendPunchPacketHardSymResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendPunchPacketHardSymResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut next_port_index__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::NextPortIndex => {
                            if next_port_index__.is_some() {
                                return Err(serde::de::Error::duplicate_field("nextPortIndex"));
                            }
                            next_port_index__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(SendPunchPacketHardSymResponse {
                    next_port_index: next_port_index__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendPunchPacketHardSymResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SendUdpHolePunchPacketRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.connector_addr.is_some() {
            len += 1;
        }
        if self.listener_port != 0 {
            len += 1;
        }
        if self.preferred_src_ipv6.is_some() {
            len += 1;
        }
        if !self.connector_addrs.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SendUdpHolePunchPacketRequest", len)?;
        if let Some(v) = self.connector_addr.as_ref() {
            struct_ser.serialize_field("connector_addr", v)?;
        }
        if self.listener_port != 0 {
            struct_ser.serialize_field("listener_port", &self.listener_port)?;
        }
        if let Some(v) = self.preferred_src_ipv6.as_ref() {
            struct_ser.serialize_field("preferred_src_ipv6", v)?;
        }
        if !self.connector_addrs.is_empty() {
            struct_ser.serialize_field("connector_addrs", &self.connector_addrs)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SendUdpHolePunchPacketRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "connector_addr",
            "connectorAddr",
            "listener_port",
            "listenerPort",
            "preferred_src_ipv6",
            "preferredSrcIpv6",
            "connector_addrs",
            "connectorAddrs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ConnectorAddr,
            ListenerPort,
            PreferredSrcIpv6,
            ConnectorAddrs,
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
                            "connectorAddr" | "connector_addr" => Ok(GeneratedField::ConnectorAddr),
                            "listenerPort" | "listener_port" => Ok(GeneratedField::ListenerPort),
                            "preferredSrcIpv6" | "preferred_src_ipv6" => Ok(GeneratedField::PreferredSrcIpv6),
                            "connectorAddrs" | "connector_addrs" => Ok(GeneratedField::ConnectorAddrs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SendUdpHolePunchPacketRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SendUdpHolePunchPacketRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SendUdpHolePunchPacketRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut connector_addr__ = None;
                let mut listener_port__ = None;
                let mut preferred_src_ipv6__ = None;
                let mut connector_addrs__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ConnectorAddr => {
                            if connector_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectorAddr"));
                            }
                            connector_addr__ = map_.next_value()?;
                        }
                        GeneratedField::ListenerPort => {
                            if listener_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerPort"));
                            }
                            listener_port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PreferredSrcIpv6 => {
                            if preferred_src_ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preferredSrcIpv6"));
                            }
                            preferred_src_ipv6__ = map_.next_value()?;
                        }
                        GeneratedField::ConnectorAddrs => {
                            if connector_addrs__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectorAddrs"));
                            }
                            connector_addrs__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(SendUdpHolePunchPacketRequest {
                    connector_addr: connector_addr__,
                    listener_port: listener_port__.unwrap_or_default(),
                    preferred_src_ipv6: preferred_src_ipv6__,
                    connector_addrs: connector_addrs__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SendUdpHolePunchPacketRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SyncRouteInfoError {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::DuplicatePeerId => "DuplicatePeerId",
            Self::Stopped => "Stopped",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for SyncRouteInfoError {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "DuplicatePeerId",
            "Stopped",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = SyncRouteInfoError;

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
                    "DuplicatePeerId" => Ok(SyncRouteInfoError::DuplicatePeerId),
                    "Stopped" => Ok(SyncRouteInfoError::Stopped),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for SyncRouteInfoRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.my_peer_id != 0 {
            len += 1;
        }
        if self.my_session_id != 0 {
            len += 1;
        }
        if self.is_initiator {
            len += 1;
        }
        if self.peer_infos.is_some() {
            len += 1;
        }
        if self.foreign_network_infos.is_some() {
            len += 1;
        }
        if self.conn_info.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SyncRouteInfoRequest", len)?;
        if self.my_peer_id != 0 {
            struct_ser.serialize_field("my_peer_id", &self.my_peer_id)?;
        }
        if self.my_session_id != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("my_session_id", ToString::to_string(&self.my_session_id).as_str())?;
        }
        if self.is_initiator {
            struct_ser.serialize_field("is_initiator", &self.is_initiator)?;
        }
        if let Some(v) = self.peer_infos.as_ref() {
            struct_ser.serialize_field("peer_infos", v)?;
        }
        if let Some(v) = self.foreign_network_infos.as_ref() {
            struct_ser.serialize_field("foreign_network_infos", v)?;
        }
        if let Some(v) = self.conn_info.as_ref() {
            match v {
                sync_route_info_request::ConnInfo::ConnBitmap(v) => {
                    struct_ser.serialize_field("conn_bitmap", v)?;
                }
                sync_route_info_request::ConnInfo::ConnPeerList(v) => {
                    struct_ser.serialize_field("conn_peer_list", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SyncRouteInfoRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "my_peer_id",
            "myPeerId",
            "my_session_id",
            "mySessionId",
            "is_initiator",
            "isInitiator",
            "peer_infos",
            "peerInfos",
            "foreign_network_infos",
            "foreignNetworkInfos",
            "conn_bitmap",
            "connBitmap",
            "conn_peer_list",
            "connPeerList",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            MyPeerId,
            MySessionId,
            IsInitiator,
            PeerInfos,
            ForeignNetworkInfos,
            ConnBitmap,
            ConnPeerList,
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
                            "myPeerId" | "my_peer_id" => Ok(GeneratedField::MyPeerId),
                            "mySessionId" | "my_session_id" => Ok(GeneratedField::MySessionId),
                            "isInitiator" | "is_initiator" => Ok(GeneratedField::IsInitiator),
                            "peerInfos" | "peer_infos" => Ok(GeneratedField::PeerInfos),
                            "foreignNetworkInfos" | "foreign_network_infos" => Ok(GeneratedField::ForeignNetworkInfos),
                            "connBitmap" | "conn_bitmap" => Ok(GeneratedField::ConnBitmap),
                            "connPeerList" | "conn_peer_list" => Ok(GeneratedField::ConnPeerList),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SyncRouteInfoRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SyncRouteInfoRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SyncRouteInfoRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut my_peer_id__ = None;
                let mut my_session_id__ = None;
                let mut is_initiator__ = None;
                let mut peer_infos__ = None;
                let mut foreign_network_infos__ = None;
                let mut conn_info__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::MyPeerId => {
                            if my_peer_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("myPeerId"));
                            }
                            my_peer_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MySessionId => {
                            if my_session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mySessionId"));
                            }
                            my_session_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::IsInitiator => {
                            if is_initiator__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isInitiator"));
                            }
                            is_initiator__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PeerInfos => {
                            if peer_infos__.is_some() {
                                return Err(serde::de::Error::duplicate_field("peerInfos"));
                            }
                            peer_infos__ = map_.next_value()?;
                        }
                        GeneratedField::ForeignNetworkInfos => {
                            if foreign_network_infos__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignNetworkInfos"));
                            }
                            foreign_network_infos__ = map_.next_value()?;
                        }
                        GeneratedField::ConnBitmap => {
                            if conn_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connBitmap"));
                            }
                            conn_info__ = map_.next_value::<::std::option::Option<_>>()?.map(sync_route_info_request::ConnInfo::ConnBitmap)
;
                        }
                        GeneratedField::ConnPeerList => {
                            if conn_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connPeerList"));
                            }
                            conn_info__ = map_.next_value::<::std::option::Option<_>>()?.map(sync_route_info_request::ConnInfo::ConnPeerList)
;
                        }
                    }
                }
                Ok(SyncRouteInfoRequest {
                    my_peer_id: my_peer_id__.unwrap_or_default(),
                    my_session_id: my_session_id__.unwrap_or_default(),
                    is_initiator: is_initiator__.unwrap_or_default(),
                    peer_infos: peer_infos__,
                    foreign_network_infos: foreign_network_infos__,
                    conn_info: conn_info__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SyncRouteInfoRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SyncRouteInfoResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.is_initiator {
            len += 1;
        }
        if self.session_id != 0 {
            len += 1;
        }
        if self.error.is_some() {
            len += 1;
        }
        if !self.missing_peer_ids.is_empty() {
            len += 1;
        }
        if !self.missing_conn_peer_ids.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.SyncRouteInfoResponse", len)?;
        if self.is_initiator {
            struct_ser.serialize_field("is_initiator", &self.is_initiator)?;
        }
        if self.session_id != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("session_id", ToString::to_string(&self.session_id).as_str())?;
        }
        if let Some(v) = self.error.as_ref() {
            let v = SyncRouteInfoError::try_from(*v)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", *v)))?;
            struct_ser.serialize_field("error", &v)?;
        }
        if !self.missing_peer_ids.is_empty() {
            struct_ser.serialize_field("missing_peer_ids", &self.missing_peer_ids)?;
        }
        if !self.missing_conn_peer_ids.is_empty() {
            struct_ser.serialize_field("missing_conn_peer_ids", &self.missing_conn_peer_ids)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SyncRouteInfoResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "is_initiator",
            "isInitiator",
            "session_id",
            "sessionId",
            "error",
            "missing_peer_ids",
            "missingPeerIds",
            "missing_conn_peer_ids",
            "missingConnPeerIds",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            IsInitiator,
            SessionId,
            Error,
            MissingPeerIds,
            MissingConnPeerIds,
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
                            "isInitiator" | "is_initiator" => Ok(GeneratedField::IsInitiator),
                            "sessionId" | "session_id" => Ok(GeneratedField::SessionId),
                            "error" => Ok(GeneratedField::Error),
                            "missingPeerIds" | "missing_peer_ids" => Ok(GeneratedField::MissingPeerIds),
                            "missingConnPeerIds" | "missing_conn_peer_ids" => Ok(GeneratedField::MissingConnPeerIds),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SyncRouteInfoResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.SyncRouteInfoResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SyncRouteInfoResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut is_initiator__ = None;
                let mut session_id__ = None;
                let mut error__ = None;
                let mut missing_peer_ids__ = None;
                let mut missing_conn_peer_ids__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::IsInitiator => {
                            if is_initiator__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isInitiator"));
                            }
                            is_initiator__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SessionId => {
                            if session_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("sessionId"));
                            }
                            session_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = map_.next_value::<::std::option::Option<SyncRouteInfoError>>()?.map(|x| x as i32);
                        }
                        GeneratedField::MissingPeerIds => {
                            if missing_peer_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("missingPeerIds"));
                            }
                            missing_peer_ids__ = 
                                Some(map_.next_value::<Vec<::pbjson::private::NumberDeserialize<_>>>()?
                                    .into_iter().map(|x| x.0).collect())
                            ;
                        }
                        GeneratedField::MissingConnPeerIds => {
                            if missing_conn_peer_ids__.is_some() {
                                return Err(serde::de::Error::duplicate_field("missingConnPeerIds"));
                            }
                            missing_conn_peer_ids__ = 
                                Some(map_.next_value::<Vec<::pbjson::private::NumberDeserialize<_>>>()?
                                    .into_iter().map(|x| x.0).collect())
                            ;
                        }
                    }
                }
                Ok(SyncRouteInfoResponse {
                    is_initiator: is_initiator__.unwrap_or_default(),
                    session_id: session_id__.unwrap_or_default(),
                    error: error__,
                    missing_peer_ids: missing_peer_ids__.unwrap_or_default(),
                    missing_conn_peer_ids: missing_conn_peer_ids__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.SyncRouteInfoResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TcpHolePunchRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.connector_mapped_addr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.TcpHolePunchRequest", len)?;
        if let Some(v) = self.connector_mapped_addr.as_ref() {
            struct_ser.serialize_field("connector_mapped_addr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TcpHolePunchRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "connector_mapped_addr",
            "connectorMappedAddr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ConnectorMappedAddr,
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
                            "connectorMappedAddr" | "connector_mapped_addr" => Ok(GeneratedField::ConnectorMappedAddr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TcpHolePunchRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.TcpHolePunchRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TcpHolePunchRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut connector_mapped_addr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ConnectorMappedAddr => {
                            if connector_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectorMappedAddr"));
                            }
                            connector_mapped_addr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(TcpHolePunchRequest {
                    connector_mapped_addr: connector_mapped_addr__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.TcpHolePunchRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TcpHolePunchResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.listener_mapped_addr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.TcpHolePunchResponse", len)?;
        if let Some(v) = self.listener_mapped_addr.as_ref() {
            struct_ser.serialize_field("listener_mapped_addr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TcpHolePunchResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "listener_mapped_addr",
            "listenerMappedAddr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            ListenerMappedAddr,
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
                            "listenerMappedAddr" | "listener_mapped_addr" => Ok(GeneratedField::ListenerMappedAddr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TcpHolePunchResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.TcpHolePunchResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TcpHolePunchResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut listener_mapped_addr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::ListenerMappedAddr => {
                            if listener_mapped_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("listenerMappedAddr"));
                            }
                            listener_mapped_addr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(TcpHolePunchResponse {
                    listener_mapped_addr: listener_mapped_addr__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.TcpHolePunchResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TrustedCredentialPubkey {
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
        let mut struct_ser = serializer.serialize_struct("peer_rpc.TrustedCredentialPubkey", len)?;
        if !self.pubkey.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("pubkey", pbjson::private::base64::encode(&self.pubkey).as_str())?;
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
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TrustedCredentialPubkey {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "pubkey",
            "groups",
            "allow_relay",
            "allowRelay",
            "expiry_unix",
            "expiryUnix",
            "allowed_proxy_cidrs",
            "allowedProxyCidrs",
            "reusable",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Pubkey,
            Groups,
            AllowRelay,
            ExpiryUnix,
            AllowedProxyCidrs,
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
                            "pubkey" => Ok(GeneratedField::Pubkey),
                            "groups" => Ok(GeneratedField::Groups),
                            "allowRelay" | "allow_relay" => Ok(GeneratedField::AllowRelay),
                            "expiryUnix" | "expiry_unix" => Ok(GeneratedField::ExpiryUnix),
                            "allowedProxyCidrs" | "allowed_proxy_cidrs" => Ok(GeneratedField::AllowedProxyCidrs),
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
            type Value = TrustedCredentialPubkey;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.TrustedCredentialPubkey")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TrustedCredentialPubkey, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut pubkey__ = None;
                let mut groups__ = None;
                let mut allow_relay__ = None;
                let mut expiry_unix__ = None;
                let mut allowed_proxy_cidrs__ = None;
                let mut reusable__ = None;
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
                    }
                }
                Ok(TrustedCredentialPubkey {
                    pubkey: pubkey__.unwrap_or_default(),
                    groups: groups__.unwrap_or_default(),
                    allow_relay: allow_relay__.unwrap_or_default(),
                    expiry_unix: expiry_unix__.unwrap_or_default(),
                    allowed_proxy_cidrs: allowed_proxy_cidrs__.unwrap_or_default(),
                    reusable: reusable__,
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.TrustedCredentialPubkey", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TrustedCredentialPubkeyProof {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.credential.is_some() {
            len += 1;
        }
        if !self.credential_hmac.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("peer_rpc.TrustedCredentialPubkeyProof", len)?;
        if let Some(v) = self.credential.as_ref() {
            struct_ser.serialize_field("credential", v)?;
        }
        if !self.credential_hmac.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("credential_hmac", pbjson::private::base64::encode(&self.credential_hmac).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TrustedCredentialPubkeyProof {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "credential",
            "credential_hmac",
            "credentialHmac",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Credential,
            CredentialHmac,
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
                            "credential" => Ok(GeneratedField::Credential),
                            "credentialHmac" | "credential_hmac" => Ok(GeneratedField::CredentialHmac),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TrustedCredentialPubkeyProof;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct peer_rpc.TrustedCredentialPubkeyProof")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TrustedCredentialPubkeyProof, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut credential__ = None;
                let mut credential_hmac__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Credential => {
                            if credential__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credential"));
                            }
                            credential__ = map_.next_value()?;
                        }
                        GeneratedField::CredentialHmac => {
                            if credential_hmac__.is_some() {
                                return Err(serde::de::Error::duplicate_field("credentialHmac"));
                            }
                            credential_hmac__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(TrustedCredentialPubkeyProof {
                    credential: credential__,
                    credential_hmac: credential_hmac__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("peer_rpc.TrustedCredentialPubkeyProof", FIELDS, GeneratedVisitor)
    }
}
