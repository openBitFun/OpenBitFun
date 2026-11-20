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
        let mut struct_ser = serializer.serialize_struct("core.peer.ListPublicIpv6InfoResponse", len)?;
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
                formatter.write_str("struct core.peer.ListPublicIpv6InfoResponse")
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
        deserializer.deserialize_struct("core.peer.ListPublicIpv6InfoResponse", FIELDS, GeneratedVisitor)
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
        let mut struct_ser = serializer.serialize_struct("core.peer.PeerConnFecStats", len)?;
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
                formatter.write_str("struct core.peer.PeerConnFecStats")
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
        deserializer.deserialize_struct("core.peer.PeerConnFecStats", FIELDS, GeneratedVisitor)
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
        let mut struct_ser = serializer.serialize_struct("core.peer.PeerConnInfo", len)?;
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
                formatter.write_str("struct core.peer.PeerConnInfo")
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
        deserializer.deserialize_struct("core.peer.PeerConnInfo", FIELDS, GeneratedVisitor)
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
        let mut struct_ser = serializer.serialize_struct("core.peer.PeerConnStats", len)?;
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
                formatter.write_str("struct core.peer.PeerConnStats")
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
        deserializer.deserialize_struct("core.peer.PeerConnStats", FIELDS, GeneratedVisitor)
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
        let mut struct_ser = serializer.serialize_struct("core.peer.PeerInfo", len)?;
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
                formatter.write_str("struct core.peer.PeerInfo")
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
        deserializer.deserialize_struct("core.peer.PeerInfo", FIELDS, GeneratedVisitor)
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
        let mut struct_ser = serializer.serialize_struct("core.peer.PublicIpv6LeaseInfo", len)?;
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
                formatter.write_str("struct core.peer.PublicIpv6LeaseInfo")
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
        deserializer.deserialize_struct("core.peer.PublicIpv6LeaseInfo", FIELDS, GeneratedVisitor)
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
        let mut struct_ser = serializer.serialize_struct("core.peer.Route", len)?;
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
                formatter.write_str("struct core.peer.Route")
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
        deserializer.deserialize_struct("core.peer.Route", FIELDS, GeneratedVisitor)
    }
}
