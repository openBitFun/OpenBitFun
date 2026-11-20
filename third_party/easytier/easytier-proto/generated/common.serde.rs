impl serde::Serialize for CompressionAlgoPb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Invalid => "Invalid",
            Self::None => "None",
            Self::Zstd => "Zstd",
            Self::Lzo => "Lzo",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for CompressionAlgoPb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Invalid",
            "None",
            "Zstd",
            "Lzo",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = CompressionAlgoPb;

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
                    "Invalid" => Ok(CompressionAlgoPb::Invalid),
                    "None" => Ok(CompressionAlgoPb::None),
                    "Zstd" => Ok(CompressionAlgoPb::Zstd),
                    "Lzo" => Ok(CompressionAlgoPb::Lzo),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for DirectRpcRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.full_method_name.is_empty() {
            len += 1;
        }
        if !self.request.is_empty() {
            len += 1;
        }
        if self.timeout_ms.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.DirectRpcRequest", len)?;
        if !self.full_method_name.is_empty() {
            struct_ser.serialize_field("full_method_name", &self.full_method_name)?;
        }
        if !self.request.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("request", pbjson::private::base64::encode(&self.request).as_str())?;
        }
        if let Some(v) = self.timeout_ms.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("timeout_ms", ToString::to_string(&v).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DirectRpcRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "full_method_name",
            "fullMethodName",
            "request",
            "timeout_ms",
            "timeoutMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            FullMethodName,
            Request,
            TimeoutMs,
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
                            "fullMethodName" | "full_method_name" => Ok(GeneratedField::FullMethodName),
                            "request" => Ok(GeneratedField::Request),
                            "timeoutMs" | "timeout_ms" => Ok(GeneratedField::TimeoutMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DirectRpcRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.DirectRpcRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DirectRpcRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut full_method_name__ = None;
                let mut request__ = None;
                let mut timeout_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::FullMethodName => {
                            if full_method_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fullMethodName"));
                            }
                            full_method_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Request => {
                            if request__.is_some() {
                                return Err(serde::de::Error::duplicate_field("request"));
                            }
                            request__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TimeoutMs => {
                            if timeout_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timeoutMs"));
                            }
                            timeout_ms__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(DirectRpcRequest {
                    full_method_name: full_method_name__.unwrap_or_default(),
                    request: request__.unwrap_or_default(),
                    timeout_ms: timeout_ms__,
                })
            }
        }
        deserializer.deserialize_struct("common.DirectRpcRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Flags {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.default_protocol.is_empty() {
            len += 1;
        }
        if !self.dev_name.is_empty() {
            len += 1;
        }
        if self.enable_encryption {
            len += 1;
        }
        if self.enable_ipv6 {
            len += 1;
        }
        if self.mtu != 0 {
            len += 1;
        }
        if self.latency_first {
            len += 1;
        }
        if self.enable_exit_node {
            len += 1;
        }
        if self.no_tun {
            len += 1;
        }
        if self.use_smoltcp {
            len += 1;
        }
        if !self.relay_network_whitelist.is_empty() {
            len += 1;
        }
        if self.disable_p2p {
            len += 1;
        }
        if self.relay_all_peer_rpc {
            len += 1;
        }
        if self.disable_udp_hole_punching {
            len += 1;
        }
        if self.multi_thread {
            len += 1;
        }
        if self.data_compress_algo != 0 {
            len += 1;
        }
        if self.bind_device {
            len += 1;
        }
        if self.enable_kcp_proxy {
            len += 1;
        }
        if self.disable_kcp_input {
            len += 1;
        }
        if self.disable_relay_kcp {
            len += 1;
        }
        if self.proxy_forward_by_system {
            len += 1;
        }
        if self.accept_dns {
            len += 1;
        }
        if self.private_mode {
            len += 1;
        }
        if self.enable_quic_proxy {
            len += 1;
        }
        if self.disable_quic_input {
            len += 1;
        }
        if self.disable_relay_quic {
            len += 1;
        }
        if self.quic_listen_port != 0 {
            len += 1;
        }
        if self.foreign_relay_bps_limit != 0 {
            len += 1;
        }
        if self.multi_thread_count != 0 {
            len += 1;
        }
        if self.enable_relay_foreign_network_kcp {
            len += 1;
        }
        if self.enable_relay_foreign_network_quic {
            len += 1;
        }
        if !self.encryption_algorithm.is_empty() {
            len += 1;
        }
        if self.disable_sym_hole_punching {
            len += 1;
        }
        if !self.tld_dns_zone.is_empty() {
            len += 1;
        }
        if self.p2p_only {
            len += 1;
        }
        if self.disable_tcp_hole_punching {
            len += 1;
        }
        if self.lazy_p2p {
            len += 1;
        }
        if self.need_p2p {
            len += 1;
        }
        if self.instance_recv_bps_limit != 0 {
            len += 1;
        }
        if self.disable_upnp {
            len += 1;
        }
        if self.disable_relay_data {
            len += 1;
        }
        if self.enable_udp_broadcast_relay {
            len += 1;
        }
        if self.socket_mark.is_some() {
            len += 1;
        }
        if self.prefer_peer_relay {
            len += 1;
        }
        if self.enable_udp_fec {
            len += 1;
        }
        if self.enable_udp_fec_kcp {
            len += 1;
        }
        if self.enable_udp_fec_quic {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.Flags", len)?;
        if !self.default_protocol.is_empty() {
            struct_ser.serialize_field("default_protocol", &self.default_protocol)?;
        }
        if !self.dev_name.is_empty() {
            struct_ser.serialize_field("dev_name", &self.dev_name)?;
        }
        if self.enable_encryption {
            struct_ser.serialize_field("enable_encryption", &self.enable_encryption)?;
        }
        if self.enable_ipv6 {
            struct_ser.serialize_field("enable_ipv6", &self.enable_ipv6)?;
        }
        if self.mtu != 0 {
            struct_ser.serialize_field("mtu", &self.mtu)?;
        }
        if self.latency_first {
            struct_ser.serialize_field("latency_first", &self.latency_first)?;
        }
        if self.enable_exit_node {
            struct_ser.serialize_field("enable_exit_node", &self.enable_exit_node)?;
        }
        if self.no_tun {
            struct_ser.serialize_field("no_tun", &self.no_tun)?;
        }
        if self.use_smoltcp {
            struct_ser.serialize_field("use_smoltcp", &self.use_smoltcp)?;
        }
        if !self.relay_network_whitelist.is_empty() {
            struct_ser.serialize_field("relay_network_whitelist", &self.relay_network_whitelist)?;
        }
        if self.disable_p2p {
            struct_ser.serialize_field("disable_p2p", &self.disable_p2p)?;
        }
        if self.relay_all_peer_rpc {
            struct_ser.serialize_field("relay_all_peer_rpc", &self.relay_all_peer_rpc)?;
        }
        if self.disable_udp_hole_punching {
            struct_ser.serialize_field("disable_udp_hole_punching", &self.disable_udp_hole_punching)?;
        }
        if self.multi_thread {
            struct_ser.serialize_field("multi_thread", &self.multi_thread)?;
        }
        if self.data_compress_algo != 0 {
            let v = CompressionAlgoPb::try_from(self.data_compress_algo)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.data_compress_algo)))?;
            struct_ser.serialize_field("data_compress_algo", &v)?;
        }
        if self.bind_device {
            struct_ser.serialize_field("bind_device", &self.bind_device)?;
        }
        if self.enable_kcp_proxy {
            struct_ser.serialize_field("enable_kcp_proxy", &self.enable_kcp_proxy)?;
        }
        if self.disable_kcp_input {
            struct_ser.serialize_field("disable_kcp_input", &self.disable_kcp_input)?;
        }
        if self.disable_relay_kcp {
            struct_ser.serialize_field("disable_relay_kcp", &self.disable_relay_kcp)?;
        }
        if self.proxy_forward_by_system {
            struct_ser.serialize_field("proxy_forward_by_system", &self.proxy_forward_by_system)?;
        }
        if self.accept_dns {
            struct_ser.serialize_field("accept_dns", &self.accept_dns)?;
        }
        if self.private_mode {
            struct_ser.serialize_field("private_mode", &self.private_mode)?;
        }
        if self.enable_quic_proxy {
            struct_ser.serialize_field("enable_quic_proxy", &self.enable_quic_proxy)?;
        }
        if self.disable_quic_input {
            struct_ser.serialize_field("disable_quic_input", &self.disable_quic_input)?;
        }
        if self.disable_relay_quic {
            struct_ser.serialize_field("disable_relay_quic", &self.disable_relay_quic)?;
        }
        if self.quic_listen_port != 0 {
            struct_ser.serialize_field("quic_listen_port", &self.quic_listen_port)?;
        }
        if self.foreign_relay_bps_limit != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("foreign_relay_bps_limit", ToString::to_string(&self.foreign_relay_bps_limit).as_str())?;
        }
        if self.multi_thread_count != 0 {
            struct_ser.serialize_field("multi_thread_count", &self.multi_thread_count)?;
        }
        if self.enable_relay_foreign_network_kcp {
            struct_ser.serialize_field("enable_relay_foreign_network_kcp", &self.enable_relay_foreign_network_kcp)?;
        }
        if self.enable_relay_foreign_network_quic {
            struct_ser.serialize_field("enable_relay_foreign_network_quic", &self.enable_relay_foreign_network_quic)?;
        }
        if !self.encryption_algorithm.is_empty() {
            struct_ser.serialize_field("encryption_algorithm", &self.encryption_algorithm)?;
        }
        if self.disable_sym_hole_punching {
            struct_ser.serialize_field("disable_sym_hole_punching", &self.disable_sym_hole_punching)?;
        }
        if !self.tld_dns_zone.is_empty() {
            struct_ser.serialize_field("tld_dns_zone", &self.tld_dns_zone)?;
        }
        if self.p2p_only {
            struct_ser.serialize_field("p2p_only", &self.p2p_only)?;
        }
        if self.disable_tcp_hole_punching {
            struct_ser.serialize_field("disable_tcp_hole_punching", &self.disable_tcp_hole_punching)?;
        }
        if self.lazy_p2p {
            struct_ser.serialize_field("lazy_p2p", &self.lazy_p2p)?;
        }
        if self.need_p2p {
            struct_ser.serialize_field("need_p2p", &self.need_p2p)?;
        }
        if self.instance_recv_bps_limit != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("instance_recv_bps_limit", ToString::to_string(&self.instance_recv_bps_limit).as_str())?;
        }
        if self.disable_upnp {
            struct_ser.serialize_field("disable_upnp", &self.disable_upnp)?;
        }
        if self.disable_relay_data {
            struct_ser.serialize_field("disable_relay_data", &self.disable_relay_data)?;
        }
        if self.enable_udp_broadcast_relay {
            struct_ser.serialize_field("enable_udp_broadcast_relay", &self.enable_udp_broadcast_relay)?;
        }
        if let Some(v) = self.socket_mark.as_ref() {
            struct_ser.serialize_field("socket_mark", v)?;
        }
        if self.prefer_peer_relay {
            struct_ser.serialize_field("prefer_peer_relay", &self.prefer_peer_relay)?;
        }
        if self.enable_udp_fec {
            struct_ser.serialize_field("enable_udp_fec", &self.enable_udp_fec)?;
        }
        if self.enable_udp_fec_kcp {
            struct_ser.serialize_field("enable_udp_fec_kcp", &self.enable_udp_fec_kcp)?;
        }
        if self.enable_udp_fec_quic {
            struct_ser.serialize_field("enable_udp_fec_quic", &self.enable_udp_fec_quic)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Flags {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "default_protocol",
            "defaultProtocol",
            "dev_name",
            "devName",
            "enable_encryption",
            "enableEncryption",
            "enable_ipv6",
            "enableIpv6",
            "mtu",
            "latency_first",
            "latencyFirst",
            "enable_exit_node",
            "enableExitNode",
            "no_tun",
            "noTun",
            "use_smoltcp",
            "useSmoltcp",
            "relay_network_whitelist",
            "relayNetworkWhitelist",
            "disable_p2p",
            "disableP2p",
            "relay_all_peer_rpc",
            "relayAllPeerRpc",
            "disable_udp_hole_punching",
            "disableUdpHolePunching",
            "multi_thread",
            "multiThread",
            "data_compress_algo",
            "dataCompressAlgo",
            "bind_device",
            "bindDevice",
            "enable_kcp_proxy",
            "enableKcpProxy",
            "disable_kcp_input",
            "disableKcpInput",
            "disable_relay_kcp",
            "disableRelayKcp",
            "proxy_forward_by_system",
            "proxyForwardBySystem",
            "accept_dns",
            "acceptDns",
            "private_mode",
            "privateMode",
            "enable_quic_proxy",
            "enableQuicProxy",
            "disable_quic_input",
            "disableQuicInput",
            "disable_relay_quic",
            "disableRelayQuic",
            "quic_listen_port",
            "quicListenPort",
            "foreign_relay_bps_limit",
            "foreignRelayBpsLimit",
            "multi_thread_count",
            "multiThreadCount",
            "enable_relay_foreign_network_kcp",
            "enableRelayForeignNetworkKcp",
            "enable_relay_foreign_network_quic",
            "enableRelayForeignNetworkQuic",
            "encryption_algorithm",
            "encryptionAlgorithm",
            "disable_sym_hole_punching",
            "disableSymHolePunching",
            "tld_dns_zone",
            "tldDnsZone",
            "p2p_only",
            "p2pOnly",
            "disable_tcp_hole_punching",
            "disableTcpHolePunching",
            "lazy_p2p",
            "lazyP2p",
            "need_p2p",
            "needP2p",
            "instance_recv_bps_limit",
            "instanceRecvBpsLimit",
            "disable_upnp",
            "disableUpnp",
            "disable_relay_data",
            "disableRelayData",
            "enable_udp_broadcast_relay",
            "enableUdpBroadcastRelay",
            "socket_mark",
            "socketMark",
            "prefer_peer_relay",
            "preferPeerRelay",
            "enable_udp_fec",
            "enableUdpFec",
            "enable_udp_fec_kcp",
            "enableUdpFecKcp",
            "enable_udp_fec_quic",
            "enableUdpFecQuic",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DefaultProtocol,
            DevName,
            EnableEncryption,
            EnableIpv6,
            Mtu,
            LatencyFirst,
            EnableExitNode,
            NoTun,
            UseSmoltcp,
            RelayNetworkWhitelist,
            DisableP2p,
            RelayAllPeerRpc,
            DisableUdpHolePunching,
            MultiThread,
            DataCompressAlgo,
            BindDevice,
            EnableKcpProxy,
            DisableKcpInput,
            DisableRelayKcp,
            ProxyForwardBySystem,
            AcceptDns,
            PrivateMode,
            EnableQuicProxy,
            DisableQuicInput,
            DisableRelayQuic,
            QuicListenPort,
            ForeignRelayBpsLimit,
            MultiThreadCount,
            EnableRelayForeignNetworkKcp,
            EnableRelayForeignNetworkQuic,
            EncryptionAlgorithm,
            DisableSymHolePunching,
            TldDnsZone,
            P2pOnly,
            DisableTcpHolePunching,
            LazyP2p,
            NeedP2p,
            InstanceRecvBpsLimit,
            DisableUpnp,
            DisableRelayData,
            EnableUdpBroadcastRelay,
            SocketMark,
            PreferPeerRelay,
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
                            "defaultProtocol" | "default_protocol" => Ok(GeneratedField::DefaultProtocol),
                            "devName" | "dev_name" => Ok(GeneratedField::DevName),
                            "enableEncryption" | "enable_encryption" => Ok(GeneratedField::EnableEncryption),
                            "enableIpv6" | "enable_ipv6" => Ok(GeneratedField::EnableIpv6),
                            "mtu" => Ok(GeneratedField::Mtu),
                            "latencyFirst" | "latency_first" => Ok(GeneratedField::LatencyFirst),
                            "enableExitNode" | "enable_exit_node" => Ok(GeneratedField::EnableExitNode),
                            "noTun" | "no_tun" => Ok(GeneratedField::NoTun),
                            "useSmoltcp" | "use_smoltcp" => Ok(GeneratedField::UseSmoltcp),
                            "relayNetworkWhitelist" | "relay_network_whitelist" => Ok(GeneratedField::RelayNetworkWhitelist),
                            "disableP2p" | "disable_p2p" => Ok(GeneratedField::DisableP2p),
                            "relayAllPeerRpc" | "relay_all_peer_rpc" => Ok(GeneratedField::RelayAllPeerRpc),
                            "disableUdpHolePunching" | "disable_udp_hole_punching" => Ok(GeneratedField::DisableUdpHolePunching),
                            "multiThread" | "multi_thread" => Ok(GeneratedField::MultiThread),
                            "dataCompressAlgo" | "data_compress_algo" => Ok(GeneratedField::DataCompressAlgo),
                            "bindDevice" | "bind_device" => Ok(GeneratedField::BindDevice),
                            "enableKcpProxy" | "enable_kcp_proxy" => Ok(GeneratedField::EnableKcpProxy),
                            "disableKcpInput" | "disable_kcp_input" => Ok(GeneratedField::DisableKcpInput),
                            "disableRelayKcp" | "disable_relay_kcp" => Ok(GeneratedField::DisableRelayKcp),
                            "proxyForwardBySystem" | "proxy_forward_by_system" => Ok(GeneratedField::ProxyForwardBySystem),
                            "acceptDns" | "accept_dns" => Ok(GeneratedField::AcceptDns),
                            "privateMode" | "private_mode" => Ok(GeneratedField::PrivateMode),
                            "enableQuicProxy" | "enable_quic_proxy" => Ok(GeneratedField::EnableQuicProxy),
                            "disableQuicInput" | "disable_quic_input" => Ok(GeneratedField::DisableQuicInput),
                            "disableRelayQuic" | "disable_relay_quic" => Ok(GeneratedField::DisableRelayQuic),
                            "quicListenPort" | "quic_listen_port" => Ok(GeneratedField::QuicListenPort),
                            "foreignRelayBpsLimit" | "foreign_relay_bps_limit" => Ok(GeneratedField::ForeignRelayBpsLimit),
                            "multiThreadCount" | "multi_thread_count" => Ok(GeneratedField::MultiThreadCount),
                            "enableRelayForeignNetworkKcp" | "enable_relay_foreign_network_kcp" => Ok(GeneratedField::EnableRelayForeignNetworkKcp),
                            "enableRelayForeignNetworkQuic" | "enable_relay_foreign_network_quic" => Ok(GeneratedField::EnableRelayForeignNetworkQuic),
                            "encryptionAlgorithm" | "encryption_algorithm" => Ok(GeneratedField::EncryptionAlgorithm),
                            "disableSymHolePunching" | "disable_sym_hole_punching" => Ok(GeneratedField::DisableSymHolePunching),
                            "tldDnsZone" | "tld_dns_zone" => Ok(GeneratedField::TldDnsZone),
                            "p2pOnly" | "p2p_only" => Ok(GeneratedField::P2pOnly),
                            "disableTcpHolePunching" | "disable_tcp_hole_punching" => Ok(GeneratedField::DisableTcpHolePunching),
                            "lazyP2p" | "lazy_p2p" => Ok(GeneratedField::LazyP2p),
                            "needP2p" | "need_p2p" => Ok(GeneratedField::NeedP2p),
                            "instanceRecvBpsLimit" | "instance_recv_bps_limit" => Ok(GeneratedField::InstanceRecvBpsLimit),
                            "disableUpnp" | "disable_upnp" => Ok(GeneratedField::DisableUpnp),
                            "disableRelayData" | "disable_relay_data" => Ok(GeneratedField::DisableRelayData),
                            "enableUdpBroadcastRelay" | "enable_udp_broadcast_relay" => Ok(GeneratedField::EnableUdpBroadcastRelay),
                            "socketMark" | "socket_mark" => Ok(GeneratedField::SocketMark),
                            "preferPeerRelay" | "prefer_peer_relay" => Ok(GeneratedField::PreferPeerRelay),
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
            type Value = Flags;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Flags")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Flags, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut default_protocol__ = None;
                let mut dev_name__ = None;
                let mut enable_encryption__ = None;
                let mut enable_ipv6__ = None;
                let mut mtu__ = None;
                let mut latency_first__ = None;
                let mut enable_exit_node__ = None;
                let mut no_tun__ = None;
                let mut use_smoltcp__ = None;
                let mut relay_network_whitelist__ = None;
                let mut disable_p2p__ = None;
                let mut relay_all_peer_rpc__ = None;
                let mut disable_udp_hole_punching__ = None;
                let mut multi_thread__ = None;
                let mut data_compress_algo__ = None;
                let mut bind_device__ = None;
                let mut enable_kcp_proxy__ = None;
                let mut disable_kcp_input__ = None;
                let mut disable_relay_kcp__ = None;
                let mut proxy_forward_by_system__ = None;
                let mut accept_dns__ = None;
                let mut private_mode__ = None;
                let mut enable_quic_proxy__ = None;
                let mut disable_quic_input__ = None;
                let mut disable_relay_quic__ = None;
                let mut quic_listen_port__ = None;
                let mut foreign_relay_bps_limit__ = None;
                let mut multi_thread_count__ = None;
                let mut enable_relay_foreign_network_kcp__ = None;
                let mut enable_relay_foreign_network_quic__ = None;
                let mut encryption_algorithm__ = None;
                let mut disable_sym_hole_punching__ = None;
                let mut tld_dns_zone__ = None;
                let mut p2p_only__ = None;
                let mut disable_tcp_hole_punching__ = None;
                let mut lazy_p2p__ = None;
                let mut need_p2p__ = None;
                let mut instance_recv_bps_limit__ = None;
                let mut disable_upnp__ = None;
                let mut disable_relay_data__ = None;
                let mut enable_udp_broadcast_relay__ = None;
                let mut socket_mark__ = None;
                let mut prefer_peer_relay__ = None;
                let mut enable_udp_fec__ = None;
                let mut enable_udp_fec_kcp__ = None;
                let mut enable_udp_fec_quic__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DefaultProtocol => {
                            if default_protocol__.is_some() {
                                return Err(serde::de::Error::duplicate_field("defaultProtocol"));
                            }
                            default_protocol__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DevName => {
                            if dev_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("devName"));
                            }
                            dev_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableEncryption => {
                            if enable_encryption__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableEncryption"));
                            }
                            enable_encryption__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableIpv6 => {
                            if enable_ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableIpv6"));
                            }
                            enable_ipv6__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Mtu => {
                            if mtu__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mtu"));
                            }
                            mtu__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::LatencyFirst => {
                            if latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("latencyFirst"));
                            }
                            latency_first__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableExitNode => {
                            if enable_exit_node__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableExitNode"));
                            }
                            enable_exit_node__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NoTun => {
                            if no_tun__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noTun"));
                            }
                            no_tun__ = Some(map_.next_value()?);
                        }
                        GeneratedField::UseSmoltcp => {
                            if use_smoltcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("useSmoltcp"));
                            }
                            use_smoltcp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RelayNetworkWhitelist => {
                            if relay_network_whitelist__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayNetworkWhitelist"));
                            }
                            relay_network_whitelist__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableP2p => {
                            if disable_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableP2p"));
                            }
                            disable_p2p__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RelayAllPeerRpc => {
                            if relay_all_peer_rpc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayAllPeerRpc"));
                            }
                            relay_all_peer_rpc__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableUdpHolePunching => {
                            if disable_udp_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableUdpHolePunching"));
                            }
                            disable_udp_hole_punching__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MultiThread => {
                            if multi_thread__.is_some() {
                                return Err(serde::de::Error::duplicate_field("multiThread"));
                            }
                            multi_thread__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DataCompressAlgo => {
                            if data_compress_algo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dataCompressAlgo"));
                            }
                            data_compress_algo__ = Some(map_.next_value::<CompressionAlgoPb>()? as i32);
                        }
                        GeneratedField::BindDevice => {
                            if bind_device__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bindDevice"));
                            }
                            bind_device__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableKcpProxy => {
                            if enable_kcp_proxy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableKcpProxy"));
                            }
                            enable_kcp_proxy__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableKcpInput => {
                            if disable_kcp_input__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableKcpInput"));
                            }
                            disable_kcp_input__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableRelayKcp => {
                            if disable_relay_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableRelayKcp"));
                            }
                            disable_relay_kcp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ProxyForwardBySystem => {
                            if proxy_forward_by_system__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyForwardBySystem"));
                            }
                            proxy_forward_by_system__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AcceptDns => {
                            if accept_dns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("acceptDns"));
                            }
                            accept_dns__ = Some(map_.next_value()?);
                        }
                        GeneratedField::PrivateMode => {
                            if private_mode__.is_some() {
                                return Err(serde::de::Error::duplicate_field("privateMode"));
                            }
                            private_mode__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableQuicProxy => {
                            if enable_quic_proxy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableQuicProxy"));
                            }
                            enable_quic_proxy__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableQuicInput => {
                            if disable_quic_input__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableQuicInput"));
                            }
                            disable_quic_input__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableRelayQuic => {
                            if disable_relay_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableRelayQuic"));
                            }
                            disable_relay_quic__ = Some(map_.next_value()?);
                        }
                        GeneratedField::QuicListenPort => {
                            if quic_listen_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("quicListenPort"));
                            }
                            quic_listen_port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ForeignRelayBpsLimit => {
                            if foreign_relay_bps_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("foreignRelayBpsLimit"));
                            }
                            foreign_relay_bps_limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MultiThreadCount => {
                            if multi_thread_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("multiThreadCount"));
                            }
                            multi_thread_count__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::EnableRelayForeignNetworkKcp => {
                            if enable_relay_foreign_network_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableRelayForeignNetworkKcp"));
                            }
                            enable_relay_foreign_network_kcp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableRelayForeignNetworkQuic => {
                            if enable_relay_foreign_network_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableRelayForeignNetworkQuic"));
                            }
                            enable_relay_foreign_network_quic__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EncryptionAlgorithm => {
                            if encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("encryptionAlgorithm"));
                            }
                            encryption_algorithm__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableSymHolePunching => {
                            if disable_sym_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableSymHolePunching"));
                            }
                            disable_sym_hole_punching__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TldDnsZone => {
                            if tld_dns_zone__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tldDnsZone"));
                            }
                            tld_dns_zone__ = Some(map_.next_value()?);
                        }
                        GeneratedField::P2pOnly => {
                            if p2p_only__.is_some() {
                                return Err(serde::de::Error::duplicate_field("p2pOnly"));
                            }
                            p2p_only__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableTcpHolePunching => {
                            if disable_tcp_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableTcpHolePunching"));
                            }
                            disable_tcp_hole_punching__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LazyP2p => {
                            if lazy_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lazyP2p"));
                            }
                            lazy_p2p__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NeedP2p => {
                            if need_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("needP2p"));
                            }
                            need_p2p__ = Some(map_.next_value()?);
                        }
                        GeneratedField::InstanceRecvBpsLimit => {
                            if instance_recv_bps_limit__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instanceRecvBpsLimit"));
                            }
                            instance_recv_bps_limit__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::DisableUpnp => {
                            if disable_upnp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableUpnp"));
                            }
                            disable_upnp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableRelayData => {
                            if disable_relay_data__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableRelayData"));
                            }
                            disable_relay_data__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableUdpBroadcastRelay => {
                            if enable_udp_broadcast_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpBroadcastRelay"));
                            }
                            enable_udp_broadcast_relay__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SocketMark => {
                            if socket_mark__.is_some() {
                                return Err(serde::de::Error::duplicate_field("socketMark"));
                            }
                            socket_mark__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::PreferPeerRelay => {
                            if prefer_peer_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preferPeerRelay"));
                            }
                            prefer_peer_relay__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableUdpFec => {
                            if enable_udp_fec__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpFec"));
                            }
                            enable_udp_fec__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableUdpFecKcp => {
                            if enable_udp_fec_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpFecKcp"));
                            }
                            enable_udp_fec_kcp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EnableUdpFecQuic => {
                            if enable_udp_fec_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableUdpFecQuic"));
                            }
                            enable_udp_fec_quic__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Flags {
                    default_protocol: default_protocol__.unwrap_or_default(),
                    dev_name: dev_name__.unwrap_or_default(),
                    enable_encryption: enable_encryption__.unwrap_or_default(),
                    enable_ipv6: enable_ipv6__.unwrap_or_default(),
                    mtu: mtu__.unwrap_or_default(),
                    latency_first: latency_first__.unwrap_or_default(),
                    enable_exit_node: enable_exit_node__.unwrap_or_default(),
                    no_tun: no_tun__.unwrap_or_default(),
                    use_smoltcp: use_smoltcp__.unwrap_or_default(),
                    relay_network_whitelist: relay_network_whitelist__.unwrap_or_default(),
                    disable_p2p: disable_p2p__.unwrap_or_default(),
                    relay_all_peer_rpc: relay_all_peer_rpc__.unwrap_or_default(),
                    disable_udp_hole_punching: disable_udp_hole_punching__.unwrap_or_default(),
                    multi_thread: multi_thread__.unwrap_or_default(),
                    data_compress_algo: data_compress_algo__.unwrap_or_default(),
                    bind_device: bind_device__.unwrap_or_default(),
                    enable_kcp_proxy: enable_kcp_proxy__.unwrap_or_default(),
                    disable_kcp_input: disable_kcp_input__.unwrap_or_default(),
                    disable_relay_kcp: disable_relay_kcp__.unwrap_or_default(),
                    proxy_forward_by_system: proxy_forward_by_system__.unwrap_or_default(),
                    accept_dns: accept_dns__.unwrap_or_default(),
                    private_mode: private_mode__.unwrap_or_default(),
                    enable_quic_proxy: enable_quic_proxy__.unwrap_or_default(),
                    disable_quic_input: disable_quic_input__.unwrap_or_default(),
                    disable_relay_quic: disable_relay_quic__.unwrap_or_default(),
                    quic_listen_port: quic_listen_port__.unwrap_or_default(),
                    foreign_relay_bps_limit: foreign_relay_bps_limit__.unwrap_or_default(),
                    multi_thread_count: multi_thread_count__.unwrap_or_default(),
                    enable_relay_foreign_network_kcp: enable_relay_foreign_network_kcp__.unwrap_or_default(),
                    enable_relay_foreign_network_quic: enable_relay_foreign_network_quic__.unwrap_or_default(),
                    encryption_algorithm: encryption_algorithm__.unwrap_or_default(),
                    disable_sym_hole_punching: disable_sym_hole_punching__.unwrap_or_default(),
                    tld_dns_zone: tld_dns_zone__.unwrap_or_default(),
                    p2p_only: p2p_only__.unwrap_or_default(),
                    disable_tcp_hole_punching: disable_tcp_hole_punching__.unwrap_or_default(),
                    lazy_p2p: lazy_p2p__.unwrap_or_default(),
                    need_p2p: need_p2p__.unwrap_or_default(),
                    instance_recv_bps_limit: instance_recv_bps_limit__.unwrap_or_default(),
                    disable_upnp: disable_upnp__.unwrap_or_default(),
                    disable_relay_data: disable_relay_data__.unwrap_or_default(),
                    enable_udp_broadcast_relay: enable_udp_broadcast_relay__.unwrap_or_default(),
                    socket_mark: socket_mark__,
                    prefer_peer_relay: prefer_peer_relay__.unwrap_or_default(),
                    enable_udp_fec: enable_udp_fec__.unwrap_or_default(),
                    enable_udp_fec_kcp: enable_udp_fec_kcp__.unwrap_or_default(),
                    enable_udp_fec_quic: enable_udp_fec_quic__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.Flags", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FlagsPatch {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.default_protocol.is_some() {
            len += 1;
        }
        if self.dev_name.is_some() {
            len += 1;
        }
        if self.enable_encryption.is_some() {
            len += 1;
        }
        if self.enable_ipv6.is_some() {
            len += 1;
        }
        if self.mtu.is_some() {
            len += 1;
        }
        if self.latency_first.is_some() {
            len += 1;
        }
        if self.enable_exit_node.is_some() {
            len += 1;
        }
        if self.no_tun.is_some() {
            len += 1;
        }
        if self.use_smoltcp.is_some() {
            len += 1;
        }
        if self.relay_network_whitelist.is_some() {
            len += 1;
        }
        if self.disable_p2p.is_some() {
            len += 1;
        }
        if self.relay_all_peer_rpc.is_some() {
            len += 1;
        }
        if self.disable_udp_hole_punching.is_some() {
            len += 1;
        }
        if self.multi_thread.is_some() {
            len += 1;
        }
        if self.data_compress_algo.is_some() {
            len += 1;
        }
        if self.bind_device.is_some() {
            len += 1;
        }
        if self.enable_kcp_proxy.is_some() {
            len += 1;
        }
        if self.disable_kcp_input.is_some() {
            len += 1;
        }
        if self.disable_relay_kcp.is_some() {
            len += 1;
        }
        if self.proxy_forward_by_system.is_some() {
            len += 1;
        }
        if self.accept_dns.is_some() {
            len += 1;
        }
        if self.private_mode.is_some() {
            len += 1;
        }
        if self.enable_quic_proxy.is_some() {
            len += 1;
        }
        if self.disable_quic_input.is_some() {
            len += 1;
        }
        if self.disable_relay_quic.is_some() {
            len += 1;
        }
        if self.quic_listen_port.is_some() {
            len += 1;
        }
        if self.foreign_relay_bps_limit.is_some() {
            len += 1;
        }
        if self.multi_thread_count.is_some() {
            len += 1;
        }
        if self.enable_relay_foreign_network_kcp.is_some() {
            len += 1;
        }
        if self.enable_relay_foreign_network_quic.is_some() {
            len += 1;
        }
        if self.encryption_algorithm.is_some() {
            len += 1;
        }
        if self.disable_sym_hole_punching.is_some() {
            len += 1;
        }
        if self.tld_dns_zone.is_some() {
            len += 1;
        }
        if self.p2p_only.is_some() {
            len += 1;
        }
        if self.disable_tcp_hole_punching.is_some() {
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
        if self.disable_relay_data.is_some() {
            len += 1;
        }
        if self.enable_udp_broadcast_relay.is_some() {
            len += 1;
        }
        if self.socket_mark.is_some() {
            len += 1;
        }
        if self.prefer_peer_relay.is_some() {
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
        let mut struct_ser = serializer.serialize_struct("common.FlagsPatch", len)?;
        if let Some(v) = self.default_protocol.as_ref() {
            struct_ser.serialize_field("default_protocol", v)?;
        }
        if let Some(v) = self.dev_name.as_ref() {
            struct_ser.serialize_field("dev_name", v)?;
        }
        if let Some(v) = self.enable_encryption.as_ref() {
            struct_ser.serialize_field("enable_encryption", v)?;
        }
        if let Some(v) = self.enable_ipv6.as_ref() {
            struct_ser.serialize_field("enable_ipv6", v)?;
        }
        if let Some(v) = self.mtu.as_ref() {
            struct_ser.serialize_field("mtu", v)?;
        }
        if let Some(v) = self.latency_first.as_ref() {
            struct_ser.serialize_field("latency_first", v)?;
        }
        if let Some(v) = self.enable_exit_node.as_ref() {
            struct_ser.serialize_field("enable_exit_node", v)?;
        }
        if let Some(v) = self.no_tun.as_ref() {
            struct_ser.serialize_field("no_tun", v)?;
        }
        if let Some(v) = self.use_smoltcp.as_ref() {
            struct_ser.serialize_field("use_smoltcp", v)?;
        }
        if let Some(v) = self.relay_network_whitelist.as_ref() {
            struct_ser.serialize_field("relay_network_whitelist", v)?;
        }
        if let Some(v) = self.disable_p2p.as_ref() {
            struct_ser.serialize_field("disable_p2p", v)?;
        }
        if let Some(v) = self.relay_all_peer_rpc.as_ref() {
            struct_ser.serialize_field("relay_all_peer_rpc", v)?;
        }
        if let Some(v) = self.disable_udp_hole_punching.as_ref() {
            struct_ser.serialize_field("disable_udp_hole_punching", v)?;
        }
        if let Some(v) = self.multi_thread.as_ref() {
            struct_ser.serialize_field("multi_thread", v)?;
        }
        if let Some(v) = self.data_compress_algo.as_ref() {
            let v = CompressionAlgoPb::try_from(*v)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", *v)))?;
            struct_ser.serialize_field("data_compress_algo", &v)?;
        }
        if let Some(v) = self.bind_device.as_ref() {
            struct_ser.serialize_field("bind_device", v)?;
        }
        if let Some(v) = self.enable_kcp_proxy.as_ref() {
            struct_ser.serialize_field("enable_kcp_proxy", v)?;
        }
        if let Some(v) = self.disable_kcp_input.as_ref() {
            struct_ser.serialize_field("disable_kcp_input", v)?;
        }
        if let Some(v) = self.disable_relay_kcp.as_ref() {
            struct_ser.serialize_field("disable_relay_kcp", v)?;
        }
        if let Some(v) = self.proxy_forward_by_system.as_ref() {
            struct_ser.serialize_field("proxy_forward_by_system", v)?;
        }
        if let Some(v) = self.accept_dns.as_ref() {
            struct_ser.serialize_field("accept_dns", v)?;
        }
        if let Some(v) = self.private_mode.as_ref() {
            struct_ser.serialize_field("private_mode", v)?;
        }
        if let Some(v) = self.enable_quic_proxy.as_ref() {
            struct_ser.serialize_field("enable_quic_proxy", v)?;
        }
        if let Some(v) = self.disable_quic_input.as_ref() {
            struct_ser.serialize_field("disable_quic_input", v)?;
        }
        if let Some(v) = self.disable_relay_quic.as_ref() {
            struct_ser.serialize_field("disable_relay_quic", v)?;
        }
        if let Some(v) = self.quic_listen_port.as_ref() {
            struct_ser.serialize_field("quic_listen_port", v)?;
        }
        if let Some(v) = self.foreign_relay_bps_limit.as_ref() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("foreign_relay_bps_limit", ToString::to_string(&v).as_str())?;
        }
        if let Some(v) = self.multi_thread_count.as_ref() {
            struct_ser.serialize_field("multi_thread_count", v)?;
        }
        if let Some(v) = self.enable_relay_foreign_network_kcp.as_ref() {
            struct_ser.serialize_field("enable_relay_foreign_network_kcp", v)?;
        }
        if let Some(v) = self.enable_relay_foreign_network_quic.as_ref() {
            struct_ser.serialize_field("enable_relay_foreign_network_quic", v)?;
        }
        if let Some(v) = self.encryption_algorithm.as_ref() {
            struct_ser.serialize_field("encryption_algorithm", v)?;
        }
        if let Some(v) = self.disable_sym_hole_punching.as_ref() {
            struct_ser.serialize_field("disable_sym_hole_punching", v)?;
        }
        if let Some(v) = self.tld_dns_zone.as_ref() {
            struct_ser.serialize_field("tld_dns_zone", v)?;
        }
        if let Some(v) = self.p2p_only.as_ref() {
            struct_ser.serialize_field("p2p_only", v)?;
        }
        if let Some(v) = self.disable_tcp_hole_punching.as_ref() {
            struct_ser.serialize_field("disable_tcp_hole_punching", v)?;
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
        if let Some(v) = self.disable_relay_data.as_ref() {
            struct_ser.serialize_field("disable_relay_data", v)?;
        }
        if let Some(v) = self.enable_udp_broadcast_relay.as_ref() {
            struct_ser.serialize_field("enable_udp_broadcast_relay", v)?;
        }
        if let Some(v) = self.socket_mark.as_ref() {
            struct_ser.serialize_field("socket_mark", v)?;
        }
        if let Some(v) = self.prefer_peer_relay.as_ref() {
            struct_ser.serialize_field("prefer_peer_relay", v)?;
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
impl<'de> serde::Deserialize<'de> for FlagsPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "default_protocol",
            "defaultProtocol",
            "dev_name",
            "devName",
            "enable_encryption",
            "enableEncryption",
            "enable_ipv6",
            "enableIpv6",
            "mtu",
            "latency_first",
            "latencyFirst",
            "enable_exit_node",
            "enableExitNode",
            "no_tun",
            "noTun",
            "use_smoltcp",
            "useSmoltcp",
            "relay_network_whitelist",
            "relayNetworkWhitelist",
            "disable_p2p",
            "disableP2p",
            "relay_all_peer_rpc",
            "relayAllPeerRpc",
            "disable_udp_hole_punching",
            "disableUdpHolePunching",
            "multi_thread",
            "multiThread",
            "data_compress_algo",
            "dataCompressAlgo",
            "bind_device",
            "bindDevice",
            "enable_kcp_proxy",
            "enableKcpProxy",
            "disable_kcp_input",
            "disableKcpInput",
            "disable_relay_kcp",
            "disableRelayKcp",
            "proxy_forward_by_system",
            "proxyForwardBySystem",
            "accept_dns",
            "acceptDns",
            "private_mode",
            "privateMode",
            "enable_quic_proxy",
            "enableQuicProxy",
            "disable_quic_input",
            "disableQuicInput",
            "disable_relay_quic",
            "disableRelayQuic",
            "quic_listen_port",
            "quicListenPort",
            "foreign_relay_bps_limit",
            "foreignRelayBpsLimit",
            "multi_thread_count",
            "multiThreadCount",
            "enable_relay_foreign_network_kcp",
            "enableRelayForeignNetworkKcp",
            "enable_relay_foreign_network_quic",
            "enableRelayForeignNetworkQuic",
            "encryption_algorithm",
            "encryptionAlgorithm",
            "disable_sym_hole_punching",
            "disableSymHolePunching",
            "tld_dns_zone",
            "tldDnsZone",
            "p2p_only",
            "p2pOnly",
            "disable_tcp_hole_punching",
            "disableTcpHolePunching",
            "lazy_p2p",
            "lazyP2p",
            "need_p2p",
            "needP2p",
            "instance_recv_bps_limit",
            "instanceRecvBpsLimit",
            "disable_upnp",
            "disableUpnp",
            "disable_relay_data",
            "disableRelayData",
            "enable_udp_broadcast_relay",
            "enableUdpBroadcastRelay",
            "socket_mark",
            "socketMark",
            "prefer_peer_relay",
            "preferPeerRelay",
            "enable_udp_fec",
            "enableUdpFec",
            "enable_udp_fec_kcp",
            "enableUdpFecKcp",
            "enable_udp_fec_quic",
            "enableUdpFecQuic",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DefaultProtocol,
            DevName,
            EnableEncryption,
            EnableIpv6,
            Mtu,
            LatencyFirst,
            EnableExitNode,
            NoTun,
            UseSmoltcp,
            RelayNetworkWhitelist,
            DisableP2p,
            RelayAllPeerRpc,
            DisableUdpHolePunching,
            MultiThread,
            DataCompressAlgo,
            BindDevice,
            EnableKcpProxy,
            DisableKcpInput,
            DisableRelayKcp,
            ProxyForwardBySystem,
            AcceptDns,
            PrivateMode,
            EnableQuicProxy,
            DisableQuicInput,
            DisableRelayQuic,
            QuicListenPort,
            ForeignRelayBpsLimit,
            MultiThreadCount,
            EnableRelayForeignNetworkKcp,
            EnableRelayForeignNetworkQuic,
            EncryptionAlgorithm,
            DisableSymHolePunching,
            TldDnsZone,
            P2pOnly,
            DisableTcpHolePunching,
            LazyP2p,
            NeedP2p,
            InstanceRecvBpsLimit,
            DisableUpnp,
            DisableRelayData,
            EnableUdpBroadcastRelay,
            SocketMark,
            PreferPeerRelay,
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
                            "defaultProtocol" | "default_protocol" => Ok(GeneratedField::DefaultProtocol),
                            "devName" | "dev_name" => Ok(GeneratedField::DevName),
                            "enableEncryption" | "enable_encryption" => Ok(GeneratedField::EnableEncryption),
                            "enableIpv6" | "enable_ipv6" => Ok(GeneratedField::EnableIpv6),
                            "mtu" => Ok(GeneratedField::Mtu),
                            "latencyFirst" | "latency_first" => Ok(GeneratedField::LatencyFirst),
                            "enableExitNode" | "enable_exit_node" => Ok(GeneratedField::EnableExitNode),
                            "noTun" | "no_tun" => Ok(GeneratedField::NoTun),
                            "useSmoltcp" | "use_smoltcp" => Ok(GeneratedField::UseSmoltcp),
                            "relayNetworkWhitelist" | "relay_network_whitelist" => Ok(GeneratedField::RelayNetworkWhitelist),
                            "disableP2p" | "disable_p2p" => Ok(GeneratedField::DisableP2p),
                            "relayAllPeerRpc" | "relay_all_peer_rpc" => Ok(GeneratedField::RelayAllPeerRpc),
                            "disableUdpHolePunching" | "disable_udp_hole_punching" => Ok(GeneratedField::DisableUdpHolePunching),
                            "multiThread" | "multi_thread" => Ok(GeneratedField::MultiThread),
                            "dataCompressAlgo" | "data_compress_algo" => Ok(GeneratedField::DataCompressAlgo),
                            "bindDevice" | "bind_device" => Ok(GeneratedField::BindDevice),
                            "enableKcpProxy" | "enable_kcp_proxy" => Ok(GeneratedField::EnableKcpProxy),
                            "disableKcpInput" | "disable_kcp_input" => Ok(GeneratedField::DisableKcpInput),
                            "disableRelayKcp" | "disable_relay_kcp" => Ok(GeneratedField::DisableRelayKcp),
                            "proxyForwardBySystem" | "proxy_forward_by_system" => Ok(GeneratedField::ProxyForwardBySystem),
                            "acceptDns" | "accept_dns" => Ok(GeneratedField::AcceptDns),
                            "privateMode" | "private_mode" => Ok(GeneratedField::PrivateMode),
                            "enableQuicProxy" | "enable_quic_proxy" => Ok(GeneratedField::EnableQuicProxy),
                            "disableQuicInput" | "disable_quic_input" => Ok(GeneratedField::DisableQuicInput),
                            "disableRelayQuic" | "disable_relay_quic" => Ok(GeneratedField::DisableRelayQuic),
                            "quicListenPort" | "quic_listen_port" => Ok(GeneratedField::QuicListenPort),
                            "foreignRelayBpsLimit" | "foreign_relay_bps_limit" => Ok(GeneratedField::ForeignRelayBpsLimit),
                            "multiThreadCount" | "multi_thread_count" => Ok(GeneratedField::MultiThreadCount),
                            "enableRelayForeignNetworkKcp" | "enable_relay_foreign_network_kcp" => Ok(GeneratedField::EnableRelayForeignNetworkKcp),
                            "enableRelayForeignNetworkQuic" | "enable_relay_foreign_network_quic" => Ok(GeneratedField::EnableRelayForeignNetworkQuic),
                            "encryptionAlgorithm" | "encryption_algorithm" => Ok(GeneratedField::EncryptionAlgorithm),
                            "disableSymHolePunching" | "disable_sym_hole_punching" => Ok(GeneratedField::DisableSymHolePunching),
                            "tldDnsZone" | "tld_dns_zone" => Ok(GeneratedField::TldDnsZone),
                            "p2pOnly" | "p2p_only" => Ok(GeneratedField::P2pOnly),
                            "disableTcpHolePunching" | "disable_tcp_hole_punching" => Ok(GeneratedField::DisableTcpHolePunching),
                            "lazyP2p" | "lazy_p2p" => Ok(GeneratedField::LazyP2p),
                            "needP2p" | "need_p2p" => Ok(GeneratedField::NeedP2p),
                            "instanceRecvBpsLimit" | "instance_recv_bps_limit" => Ok(GeneratedField::InstanceRecvBpsLimit),
                            "disableUpnp" | "disable_upnp" => Ok(GeneratedField::DisableUpnp),
                            "disableRelayData" | "disable_relay_data" => Ok(GeneratedField::DisableRelayData),
                            "enableUdpBroadcastRelay" | "enable_udp_broadcast_relay" => Ok(GeneratedField::EnableUdpBroadcastRelay),
                            "socketMark" | "socket_mark" => Ok(GeneratedField::SocketMark),
                            "preferPeerRelay" | "prefer_peer_relay" => Ok(GeneratedField::PreferPeerRelay),
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
            type Value = FlagsPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.FlagsPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FlagsPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut default_protocol__ = None;
                let mut dev_name__ = None;
                let mut enable_encryption__ = None;
                let mut enable_ipv6__ = None;
                let mut mtu__ = None;
                let mut latency_first__ = None;
                let mut enable_exit_node__ = None;
                let mut no_tun__ = None;
                let mut use_smoltcp__ = None;
                let mut relay_network_whitelist__ = None;
                let mut disable_p2p__ = None;
                let mut relay_all_peer_rpc__ = None;
                let mut disable_udp_hole_punching__ = None;
                let mut multi_thread__ = None;
                let mut data_compress_algo__ = None;
                let mut bind_device__ = None;
                let mut enable_kcp_proxy__ = None;
                let mut disable_kcp_input__ = None;
                let mut disable_relay_kcp__ = None;
                let mut proxy_forward_by_system__ = None;
                let mut accept_dns__ = None;
                let mut private_mode__ = None;
                let mut enable_quic_proxy__ = None;
                let mut disable_quic_input__ = None;
                let mut disable_relay_quic__ = None;
                let mut quic_listen_port__ = None;
                let mut foreign_relay_bps_limit__ = None;
                let mut multi_thread_count__ = None;
                let mut enable_relay_foreign_network_kcp__ = None;
                let mut enable_relay_foreign_network_quic__ = None;
                let mut encryption_algorithm__ = None;
                let mut disable_sym_hole_punching__ = None;
                let mut tld_dns_zone__ = None;
                let mut p2p_only__ = None;
                let mut disable_tcp_hole_punching__ = None;
                let mut lazy_p2p__ = None;
                let mut need_p2p__ = None;
                let mut instance_recv_bps_limit__ = None;
                let mut disable_upnp__ = None;
                let mut disable_relay_data__ = None;
                let mut enable_udp_broadcast_relay__ = None;
                let mut socket_mark__ = None;
                let mut prefer_peer_relay__ = None;
                let mut enable_udp_fec__ = None;
                let mut enable_udp_fec_kcp__ = None;
                let mut enable_udp_fec_quic__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DefaultProtocol => {
                            if default_protocol__.is_some() {
                                return Err(serde::de::Error::duplicate_field("defaultProtocol"));
                            }
                            default_protocol__ = map_.next_value()?;
                        }
                        GeneratedField::DevName => {
                            if dev_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("devName"));
                            }
                            dev_name__ = map_.next_value()?;
                        }
                        GeneratedField::EnableEncryption => {
                            if enable_encryption__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableEncryption"));
                            }
                            enable_encryption__ = map_.next_value()?;
                        }
                        GeneratedField::EnableIpv6 => {
                            if enable_ipv6__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableIpv6"));
                            }
                            enable_ipv6__ = map_.next_value()?;
                        }
                        GeneratedField::Mtu => {
                            if mtu__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mtu"));
                            }
                            mtu__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::LatencyFirst => {
                            if latency_first__.is_some() {
                                return Err(serde::de::Error::duplicate_field("latencyFirst"));
                            }
                            latency_first__ = map_.next_value()?;
                        }
                        GeneratedField::EnableExitNode => {
                            if enable_exit_node__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableExitNode"));
                            }
                            enable_exit_node__ = map_.next_value()?;
                        }
                        GeneratedField::NoTun => {
                            if no_tun__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noTun"));
                            }
                            no_tun__ = map_.next_value()?;
                        }
                        GeneratedField::UseSmoltcp => {
                            if use_smoltcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("useSmoltcp"));
                            }
                            use_smoltcp__ = map_.next_value()?;
                        }
                        GeneratedField::RelayNetworkWhitelist => {
                            if relay_network_whitelist__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayNetworkWhitelist"));
                            }
                            relay_network_whitelist__ = map_.next_value()?;
                        }
                        GeneratedField::DisableP2p => {
                            if disable_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableP2p"));
                            }
                            disable_p2p__ = map_.next_value()?;
                        }
                        GeneratedField::RelayAllPeerRpc => {
                            if relay_all_peer_rpc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("relayAllPeerRpc"));
                            }
                            relay_all_peer_rpc__ = map_.next_value()?;
                        }
                        GeneratedField::DisableUdpHolePunching => {
                            if disable_udp_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableUdpHolePunching"));
                            }
                            disable_udp_hole_punching__ = map_.next_value()?;
                        }
                        GeneratedField::MultiThread => {
                            if multi_thread__.is_some() {
                                return Err(serde::de::Error::duplicate_field("multiThread"));
                            }
                            multi_thread__ = map_.next_value()?;
                        }
                        GeneratedField::DataCompressAlgo => {
                            if data_compress_algo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dataCompressAlgo"));
                            }
                            data_compress_algo__ = map_.next_value::<::std::option::Option<CompressionAlgoPb>>()?.map(|x| x as i32);
                        }
                        GeneratedField::BindDevice => {
                            if bind_device__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bindDevice"));
                            }
                            bind_device__ = map_.next_value()?;
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
                        GeneratedField::DisableRelayKcp => {
                            if disable_relay_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableRelayKcp"));
                            }
                            disable_relay_kcp__ = map_.next_value()?;
                        }
                        GeneratedField::ProxyForwardBySystem => {
                            if proxy_forward_by_system__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyForwardBySystem"));
                            }
                            proxy_forward_by_system__ = map_.next_value()?;
                        }
                        GeneratedField::AcceptDns => {
                            if accept_dns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("acceptDns"));
                            }
                            accept_dns__ = map_.next_value()?;
                        }
                        GeneratedField::PrivateMode => {
                            if private_mode__.is_some() {
                                return Err(serde::de::Error::duplicate_field("privateMode"));
                            }
                            private_mode__ = map_.next_value()?;
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
                        GeneratedField::DisableRelayQuic => {
                            if disable_relay_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableRelayQuic"));
                            }
                            disable_relay_quic__ = map_.next_value()?;
                        }
                        GeneratedField::QuicListenPort => {
                            if quic_listen_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("quicListenPort"));
                            }
                            quic_listen_port__ = 
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
                        GeneratedField::MultiThreadCount => {
                            if multi_thread_count__.is_some() {
                                return Err(serde::de::Error::duplicate_field("multiThreadCount"));
                            }
                            multi_thread_count__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::EnableRelayForeignNetworkKcp => {
                            if enable_relay_foreign_network_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableRelayForeignNetworkKcp"));
                            }
                            enable_relay_foreign_network_kcp__ = map_.next_value()?;
                        }
                        GeneratedField::EnableRelayForeignNetworkQuic => {
                            if enable_relay_foreign_network_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableRelayForeignNetworkQuic"));
                            }
                            enable_relay_foreign_network_quic__ = map_.next_value()?;
                        }
                        GeneratedField::EncryptionAlgorithm => {
                            if encryption_algorithm__.is_some() {
                                return Err(serde::de::Error::duplicate_field("encryptionAlgorithm"));
                            }
                            encryption_algorithm__ = map_.next_value()?;
                        }
                        GeneratedField::DisableSymHolePunching => {
                            if disable_sym_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableSymHolePunching"));
                            }
                            disable_sym_hole_punching__ = map_.next_value()?;
                        }
                        GeneratedField::TldDnsZone => {
                            if tld_dns_zone__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tldDnsZone"));
                            }
                            tld_dns_zone__ = map_.next_value()?;
                        }
                        GeneratedField::P2pOnly => {
                            if p2p_only__.is_some() {
                                return Err(serde::de::Error::duplicate_field("p2pOnly"));
                            }
                            p2p_only__ = map_.next_value()?;
                        }
                        GeneratedField::DisableTcpHolePunching => {
                            if disable_tcp_hole_punching__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableTcpHolePunching"));
                            }
                            disable_tcp_hole_punching__ = map_.next_value()?;
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
                        GeneratedField::PreferPeerRelay => {
                            if prefer_peer_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preferPeerRelay"));
                            }
                            prefer_peer_relay__ = map_.next_value()?;
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
                Ok(FlagsPatch {
                    default_protocol: default_protocol__,
                    dev_name: dev_name__,
                    enable_encryption: enable_encryption__,
                    enable_ipv6: enable_ipv6__,
                    mtu: mtu__,
                    latency_first: latency_first__,
                    enable_exit_node: enable_exit_node__,
                    no_tun: no_tun__,
                    use_smoltcp: use_smoltcp__,
                    relay_network_whitelist: relay_network_whitelist__,
                    disable_p2p: disable_p2p__,
                    relay_all_peer_rpc: relay_all_peer_rpc__,
                    disable_udp_hole_punching: disable_udp_hole_punching__,
                    multi_thread: multi_thread__,
                    data_compress_algo: data_compress_algo__,
                    bind_device: bind_device__,
                    enable_kcp_proxy: enable_kcp_proxy__,
                    disable_kcp_input: disable_kcp_input__,
                    disable_relay_kcp: disable_relay_kcp__,
                    proxy_forward_by_system: proxy_forward_by_system__,
                    accept_dns: accept_dns__,
                    private_mode: private_mode__,
                    enable_quic_proxy: enable_quic_proxy__,
                    disable_quic_input: disable_quic_input__,
                    disable_relay_quic: disable_relay_quic__,
                    quic_listen_port: quic_listen_port__,
                    foreign_relay_bps_limit: foreign_relay_bps_limit__,
                    multi_thread_count: multi_thread_count__,
                    enable_relay_foreign_network_kcp: enable_relay_foreign_network_kcp__,
                    enable_relay_foreign_network_quic: enable_relay_foreign_network_quic__,
                    encryption_algorithm: encryption_algorithm__,
                    disable_sym_hole_punching: disable_sym_hole_punching__,
                    tld_dns_zone: tld_dns_zone__,
                    p2p_only: p2p_only__,
                    disable_tcp_hole_punching: disable_tcp_hole_punching__,
                    lazy_p2p: lazy_p2p__,
                    need_p2p: need_p2p__,
                    instance_recv_bps_limit: instance_recv_bps_limit__,
                    disable_upnp: disable_upnp__,
                    disable_relay_data: disable_relay_data__,
                    enable_udp_broadcast_relay: enable_udp_broadcast_relay__,
                    socket_mark: socket_mark__,
                    prefer_peer_relay: prefer_peer_relay__,
                    enable_udp_fec: enable_udp_fec__,
                    enable_udp_fec_kcp: enable_udp_fec_kcp__,
                    enable_udp_fec_quic: enable_udp_fec_quic__,
                })
            }
        }
        deserializer.deserialize_struct("common.FlagsPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for HostManagementRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.rpc.is_some() {
            len += 1;
        }
        if self.prepared_config.is_some() {
            len += 1;
        }
        if self.prepared_instance_id.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.HostManagementRequest", len)?;
        if let Some(v) = self.rpc.as_ref() {
            struct_ser.serialize_field("rpc", v)?;
        }
        if let Some(v) = self.prepared_config.as_ref() {
            struct_ser.serialize_field("prepared_config", v)?;
        }
        if let Some(v) = self.prepared_instance_id.as_ref() {
            struct_ser.serialize_field("prepared_instance_id", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for HostManagementRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "rpc",
            "prepared_config",
            "preparedConfig",
            "prepared_instance_id",
            "preparedInstanceId",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Rpc,
            PreparedConfig,
            PreparedInstanceId,
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
                            "rpc" => Ok(GeneratedField::Rpc),
                            "preparedConfig" | "prepared_config" => Ok(GeneratedField::PreparedConfig),
                            "preparedInstanceId" | "prepared_instance_id" => Ok(GeneratedField::PreparedInstanceId),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = HostManagementRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.HostManagementRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<HostManagementRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut rpc__ = None;
                let mut prepared_config__ = None;
                let mut prepared_instance_id__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Rpc => {
                            if rpc__.is_some() {
                                return Err(serde::de::Error::duplicate_field("rpc"));
                            }
                            rpc__ = map_.next_value()?;
                        }
                        GeneratedField::PreparedConfig => {
                            if prepared_config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preparedConfig"));
                            }
                            prepared_config__ = map_.next_value()?;
                        }
                        GeneratedField::PreparedInstanceId => {
                            if prepared_instance_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preparedInstanceId"));
                            }
                            prepared_instance_id__ = map_.next_value()?;
                        }
                    }
                }
                Ok(HostManagementRequest {
                    rpc: rpc__,
                    prepared_config: prepared_config__,
                    prepared_instance_id: prepared_instance_id__,
                })
            }
        }
        deserializer.deserialize_struct("common.HostManagementRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for IpAddr {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.ip.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.IpAddr", len)?;
        if let Some(v) = self.ip.as_ref() {
            match v {
                ip_addr::Ip::Ipv4(v) => {
                    struct_ser.serialize_field("ipv4", v)?;
                }
                ip_addr::Ip::Ipv6(v) => {
                    struct_ser.serialize_field("ipv6", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for IpAddr {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "ipv4",
            "ipv6",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Ipv4,
            Ipv6,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = IpAddr;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.IpAddr")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<IpAddr, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut ip__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Ipv4 => {
                            if ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4"));
                            }
                            ip__ = map_.next_value::<::std::option::Option<_>>()?.map(ip_addr::Ip::Ipv4)
;
                        }
                        GeneratedField::Ipv6 => {
                            if ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6"));
                            }
                            ip__ = map_.next_value::<::std::option::Option<_>>()?.map(ip_addr::Ip::Ipv6)
;
                        }
                    }
                }
                Ok(IpAddr {
                    ip: ip__,
                })
            }
        }
        deserializer.deserialize_struct("common.IpAddr", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for IpInet {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.ip.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.IpInet", len)?;
        if let Some(v) = self.ip.as_ref() {
            match v {
                ip_inet::Ip::Ipv4(v) => {
                    struct_ser.serialize_field("ipv4", v)?;
                }
                ip_inet::Ip::Ipv6(v) => {
                    struct_ser.serialize_field("ipv6", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for IpInet {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "ipv4",
            "ipv6",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Ipv4,
            Ipv6,
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
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = IpInet;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.IpInet")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<IpInet, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut ip__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Ipv4 => {
                            if ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4"));
                            }
                            ip__ = map_.next_value::<::std::option::Option<_>>()?.map(ip_inet::Ip::Ipv4)
;
                        }
                        GeneratedField::Ipv6 => {
                            if ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6"));
                            }
                            ip__ = map_.next_value::<::std::option::Option<_>>()?.map(ip_inet::Ip::Ipv6)
;
                        }
                    }
                }
                Ok(IpInet {
                    ip: ip__,
                })
            }
        }
        deserializer.deserialize_struct("common.IpInet", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Ipv4Addr {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.addr != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.Ipv4Addr", len)?;
        if self.addr != 0 {
            struct_ser.serialize_field("addr", &self.addr)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Ipv4Addr {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "addr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Addr,
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
                            "addr" => Ok(GeneratedField::Addr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Ipv4Addr;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Ipv4Addr")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Ipv4Addr, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut addr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Addr => {
                            if addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("addr"));
                            }
                            addr__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(Ipv4Addr {
                    addr: addr__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.Ipv4Addr", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Ipv4Inet {
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
        if self.network_length != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.Ipv4Inet", len)?;
        if let Some(v) = self.address.as_ref() {
            struct_ser.serialize_field("address", v)?;
        }
        if self.network_length != 0 {
            struct_ser.serialize_field("network_length", &self.network_length)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Ipv4Inet {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "address",
            "network_length",
            "networkLength",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Address,
            NetworkLength,
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
                            "networkLength" | "network_length" => Ok(GeneratedField::NetworkLength),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Ipv4Inet;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Ipv4Inet")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Ipv4Inet, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut address__ = None;
                let mut network_length__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Address => {
                            if address__.is_some() {
                                return Err(serde::de::Error::duplicate_field("address"));
                            }
                            address__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkLength => {
                            if network_length__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkLength"));
                            }
                            network_length__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(Ipv4Inet {
                    address: address__,
                    network_length: network_length__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.Ipv4Inet", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Ipv6Addr {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.part1 != 0 {
            len += 1;
        }
        if self.part2 != 0 {
            len += 1;
        }
        if self.part3 != 0 {
            len += 1;
        }
        if self.part4 != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.Ipv6Addr", len)?;
        if self.part1 != 0 {
            struct_ser.serialize_field("part1", &self.part1)?;
        }
        if self.part2 != 0 {
            struct_ser.serialize_field("part2", &self.part2)?;
        }
        if self.part3 != 0 {
            struct_ser.serialize_field("part3", &self.part3)?;
        }
        if self.part4 != 0 {
            struct_ser.serialize_field("part4", &self.part4)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Ipv6Addr {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "part1",
            "part2",
            "part3",
            "part4",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Part1,
            Part2,
            Part3,
            Part4,
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
                            "part1" => Ok(GeneratedField::Part1),
                            "part2" => Ok(GeneratedField::Part2),
                            "part3" => Ok(GeneratedField::Part3),
                            "part4" => Ok(GeneratedField::Part4),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Ipv6Addr;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Ipv6Addr")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Ipv6Addr, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut part1__ = None;
                let mut part2__ = None;
                let mut part3__ = None;
                let mut part4__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Part1 => {
                            if part1__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part1"));
                            }
                            part1__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Part2 => {
                            if part2__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part2"));
                            }
                            part2__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Part3 => {
                            if part3__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part3"));
                            }
                            part3__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Part4 => {
                            if part4__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part4"));
                            }
                            part4__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(Ipv6Addr {
                    part1: part1__.unwrap_or_default(),
                    part2: part2__.unwrap_or_default(),
                    part3: part3__.unwrap_or_default(),
                    part4: part4__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.Ipv6Addr", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Ipv6Inet {
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
        if self.network_length != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.Ipv6Inet", len)?;
        if let Some(v) = self.address.as_ref() {
            struct_ser.serialize_field("address", v)?;
        }
        if self.network_length != 0 {
            struct_ser.serialize_field("network_length", &self.network_length)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Ipv6Inet {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "address",
            "network_length",
            "networkLength",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Address,
            NetworkLength,
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
                            "networkLength" | "network_length" => Ok(GeneratedField::NetworkLength),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Ipv6Inet;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Ipv6Inet")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Ipv6Inet, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut address__ = None;
                let mut network_length__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Address => {
                            if address__.is_some() {
                                return Err(serde::de::Error::duplicate_field("address"));
                            }
                            address__ = map_.next_value()?;
                        }
                        GeneratedField::NetworkLength => {
                            if network_length__.is_some() {
                                return Err(serde::de::Error::duplicate_field("networkLength"));
                            }
                            network_length__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(Ipv6Inet {
                    address: address__,
                    network_length: network_length__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.Ipv6Inet", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for NatType {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Unknown => "Unknown",
            Self::OpenInternet => "OpenInternet",
            Self::NoPat => "NoPAT",
            Self::FullCone => "FullCone",
            Self::Restricted => "Restricted",
            Self::PortRestricted => "PortRestricted",
            Self::Symmetric => "Symmetric",
            Self::SymUdpFirewall => "SymUdpFirewall",
            Self::SymmetricEasyInc => "SymmetricEasyInc",
            Self::SymmetricEasyDec => "SymmetricEasyDec",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for NatType {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "Unknown",
            "OpenInternet",
            "NoPAT",
            "FullCone",
            "Restricted",
            "PortRestricted",
            "Symmetric",
            "SymUdpFirewall",
            "SymmetricEasyInc",
            "SymmetricEasyDec",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = NatType;

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
                    "Unknown" => Ok(NatType::Unknown),
                    "OpenInternet" => Ok(NatType::OpenInternet),
                    "NoPAT" => Ok(NatType::NoPat),
                    "FullCone" => Ok(NatType::FullCone),
                    "Restricted" => Ok(NatType::Restricted),
                    "PortRestricted" => Ok(NatType::PortRestricted),
                    "Symmetric" => Ok(NatType::Symmetric),
                    "SymUdpFirewall" => Ok(NatType::SymUdpFirewall),
                    "SymmetricEasyInc" => Ok(NatType::SymmetricEasyInc),
                    "SymmetricEasyDec" => Ok(NatType::SymmetricEasyDec),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for PeerFeatureFlag {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.is_public_server {
            len += 1;
        }
        if self.avoid_relay_data {
            len += 1;
        }
        if self.kcp_input {
            len += 1;
        }
        if self.no_relay_kcp {
            len += 1;
        }
        if self.support_conn_list_sync {
            len += 1;
        }
        if self.quic_input {
            len += 1;
        }
        if self.no_relay_quic {
            len += 1;
        }
        if self.is_credential_peer {
            len += 1;
        }
        if self.need_p2p {
            len += 1;
        }
        if self.disable_p2p {
            len += 1;
        }
        if self.ipv6_public_addr_provider {
            len += 1;
        }
        if self.obf_controller {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.PeerFeatureFlag", len)?;
        if self.is_public_server {
            struct_ser.serialize_field("is_public_server", &self.is_public_server)?;
        }
        if self.avoid_relay_data {
            struct_ser.serialize_field("avoid_relay_data", &self.avoid_relay_data)?;
        }
        if self.kcp_input {
            struct_ser.serialize_field("kcp_input", &self.kcp_input)?;
        }
        if self.no_relay_kcp {
            struct_ser.serialize_field("no_relay_kcp", &self.no_relay_kcp)?;
        }
        if self.support_conn_list_sync {
            struct_ser.serialize_field("support_conn_list_sync", &self.support_conn_list_sync)?;
        }
        if self.quic_input {
            struct_ser.serialize_field("quic_input", &self.quic_input)?;
        }
        if self.no_relay_quic {
            struct_ser.serialize_field("no_relay_quic", &self.no_relay_quic)?;
        }
        if self.is_credential_peer {
            struct_ser.serialize_field("is_credential_peer", &self.is_credential_peer)?;
        }
        if self.need_p2p {
            struct_ser.serialize_field("need_p2p", &self.need_p2p)?;
        }
        if self.disable_p2p {
            struct_ser.serialize_field("disable_p2p", &self.disable_p2p)?;
        }
        if self.ipv6_public_addr_provider {
            struct_ser.serialize_field("ipv6_public_addr_provider", &self.ipv6_public_addr_provider)?;
        }
        if self.obf_controller {
            struct_ser.serialize_field("obf_controller", &self.obf_controller)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PeerFeatureFlag {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "is_public_server",
            "isPublicServer",
            "avoid_relay_data",
            "avoidRelayData",
            "kcp_input",
            "kcpInput",
            "no_relay_kcp",
            "noRelayKcp",
            "support_conn_list_sync",
            "supportConnListSync",
            "quic_input",
            "quicInput",
            "no_relay_quic",
            "noRelayQuic",
            "is_credential_peer",
            "isCredentialPeer",
            "need_p2p",
            "needP2p",
            "disable_p2p",
            "disableP2p",
            "ipv6_public_addr_provider",
            "ipv6PublicAddrProvider",
            "obf_controller",
            "obfController",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            IsPublicServer,
            AvoidRelayData,
            KcpInput,
            NoRelayKcp,
            SupportConnListSync,
            QuicInput,
            NoRelayQuic,
            IsCredentialPeer,
            NeedP2p,
            DisableP2p,
            Ipv6PublicAddrProvider,
            ObfController,
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
                            "isPublicServer" | "is_public_server" => Ok(GeneratedField::IsPublicServer),
                            "avoidRelayData" | "avoid_relay_data" => Ok(GeneratedField::AvoidRelayData),
                            "kcpInput" | "kcp_input" => Ok(GeneratedField::KcpInput),
                            "noRelayKcp" | "no_relay_kcp" => Ok(GeneratedField::NoRelayKcp),
                            "supportConnListSync" | "support_conn_list_sync" => Ok(GeneratedField::SupportConnListSync),
                            "quicInput" | "quic_input" => Ok(GeneratedField::QuicInput),
                            "noRelayQuic" | "no_relay_quic" => Ok(GeneratedField::NoRelayQuic),
                            "isCredentialPeer" | "is_credential_peer" => Ok(GeneratedField::IsCredentialPeer),
                            "needP2p" | "need_p2p" => Ok(GeneratedField::NeedP2p),
                            "disableP2p" | "disable_p2p" => Ok(GeneratedField::DisableP2p),
                            "ipv6PublicAddrProvider" | "ipv6_public_addr_provider" => Ok(GeneratedField::Ipv6PublicAddrProvider),
                            "obfController" | "obf_controller" => Ok(GeneratedField::ObfController),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PeerFeatureFlag;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.PeerFeatureFlag")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PeerFeatureFlag, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut is_public_server__ = None;
                let mut avoid_relay_data__ = None;
                let mut kcp_input__ = None;
                let mut no_relay_kcp__ = None;
                let mut support_conn_list_sync__ = None;
                let mut quic_input__ = None;
                let mut no_relay_quic__ = None;
                let mut is_credential_peer__ = None;
                let mut need_p2p__ = None;
                let mut disable_p2p__ = None;
                let mut ipv6_public_addr_provider__ = None;
                let mut obf_controller__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::IsPublicServer => {
                            if is_public_server__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isPublicServer"));
                            }
                            is_public_server__ = Some(map_.next_value()?);
                        }
                        GeneratedField::AvoidRelayData => {
                            if avoid_relay_data__.is_some() {
                                return Err(serde::de::Error::duplicate_field("avoidRelayData"));
                            }
                            avoid_relay_data__ = Some(map_.next_value()?);
                        }
                        GeneratedField::KcpInput => {
                            if kcp_input__.is_some() {
                                return Err(serde::de::Error::duplicate_field("kcpInput"));
                            }
                            kcp_input__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NoRelayKcp => {
                            if no_relay_kcp__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noRelayKcp"));
                            }
                            no_relay_kcp__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SupportConnListSync => {
                            if support_conn_list_sync__.is_some() {
                                return Err(serde::de::Error::duplicate_field("supportConnListSync"));
                            }
                            support_conn_list_sync__ = Some(map_.next_value()?);
                        }
                        GeneratedField::QuicInput => {
                            if quic_input__.is_some() {
                                return Err(serde::de::Error::duplicate_field("quicInput"));
                            }
                            quic_input__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NoRelayQuic => {
                            if no_relay_quic__.is_some() {
                                return Err(serde::de::Error::duplicate_field("noRelayQuic"));
                            }
                            no_relay_quic__ = Some(map_.next_value()?);
                        }
                        GeneratedField::IsCredentialPeer => {
                            if is_credential_peer__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isCredentialPeer"));
                            }
                            is_credential_peer__ = Some(map_.next_value()?);
                        }
                        GeneratedField::NeedP2p => {
                            if need_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("needP2p"));
                            }
                            need_p2p__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DisableP2p => {
                            if disable_p2p__.is_some() {
                                return Err(serde::de::Error::duplicate_field("disableP2p"));
                            }
                            disable_p2p__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Ipv6PublicAddrProvider => {
                            if ipv6_public_addr_provider__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6PublicAddrProvider"));
                            }
                            ipv6_public_addr_provider__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ObfController => {
                            if obf_controller__.is_some() {
                                return Err(serde::de::Error::duplicate_field("obfController"));
                            }
                            obf_controller__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(PeerFeatureFlag {
                    is_public_server: is_public_server__.unwrap_or_default(),
                    avoid_relay_data: avoid_relay_data__.unwrap_or_default(),
                    kcp_input: kcp_input__.unwrap_or_default(),
                    no_relay_kcp: no_relay_kcp__.unwrap_or_default(),
                    support_conn_list_sync: support_conn_list_sync__.unwrap_or_default(),
                    quic_input: quic_input__.unwrap_or_default(),
                    no_relay_quic: no_relay_quic__.unwrap_or_default(),
                    is_credential_peer: is_credential_peer__.unwrap_or_default(),
                    need_p2p: need_p2p__.unwrap_or_default(),
                    disable_p2p: disable_p2p__.unwrap_or_default(),
                    ipv6_public_addr_provider: ipv6_public_addr_provider__.unwrap_or_default(),
                    obf_controller: obf_controller__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.PeerFeatureFlag", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PortForwardConfigPb {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.bind_addr.is_some() {
            len += 1;
        }
        if self.dst_addr.is_some() {
            len += 1;
        }
        if self.socket_type != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.PortForwardConfigPb", len)?;
        if let Some(v) = self.bind_addr.as_ref() {
            struct_ser.serialize_field("bind_addr", v)?;
        }
        if let Some(v) = self.dst_addr.as_ref() {
            struct_ser.serialize_field("dst_addr", v)?;
        }
        if self.socket_type != 0 {
            let v = SocketType::try_from(self.socket_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.socket_type)))?;
            struct_ser.serialize_field("socket_type", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PortForwardConfigPb {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "bind_addr",
            "bindAddr",
            "dst_addr",
            "dstAddr",
            "socket_type",
            "socketType",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            BindAddr,
            DstAddr,
            SocketType,
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
                            "bindAddr" | "bind_addr" => Ok(GeneratedField::BindAddr),
                            "dstAddr" | "dst_addr" => Ok(GeneratedField::DstAddr),
                            "socketType" | "socket_type" => Ok(GeneratedField::SocketType),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PortForwardConfigPb;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.PortForwardConfigPb")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PortForwardConfigPb, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut bind_addr__ = None;
                let mut dst_addr__ = None;
                let mut socket_type__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::BindAddr => {
                            if bind_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("bindAddr"));
                            }
                            bind_addr__ = map_.next_value()?;
                        }
                        GeneratedField::DstAddr => {
                            if dst_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dstAddr"));
                            }
                            dst_addr__ = map_.next_value()?;
                        }
                        GeneratedField::SocketType => {
                            if socket_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("socketType"));
                            }
                            socket_type__ = Some(map_.next_value::<SocketType>()? as i32);
                        }
                    }
                }
                Ok(PortForwardConfigPb {
                    bind_addr: bind_addr__,
                    dst_addr: dst_addr__,
                    socket_type: socket_type__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.PortForwardConfigPb", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ProxyDstInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.dst_addr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.ProxyDstInfo", len)?;
        if let Some(v) = self.dst_addr.as_ref() {
            struct_ser.serialize_field("dst_addr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ProxyDstInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "dst_addr",
            "dstAddr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DstAddr,
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
                            "dstAddr" | "dst_addr" => Ok(GeneratedField::DstAddr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ProxyDstInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.ProxyDstInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ProxyDstInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut dst_addr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DstAddr => {
                            if dst_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dstAddr"));
                            }
                            dst_addr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ProxyDstInfo {
                    dst_addr: dst_addr__,
                })
            }
        }
        deserializer.deserialize_struct("common.ProxyDstInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RpcCompressionInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.algo != 0 {
            len += 1;
        }
        if self.accepted_algo != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.RpcCompressionInfo", len)?;
        if self.algo != 0 {
            let v = CompressionAlgoPb::try_from(self.algo)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.algo)))?;
            struct_ser.serialize_field("algo", &v)?;
        }
        if self.accepted_algo != 0 {
            let v = CompressionAlgoPb::try_from(self.accepted_algo)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.accepted_algo)))?;
            struct_ser.serialize_field("accepted_algo", &v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RpcCompressionInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "algo",
            "accepted_algo",
            "acceptedAlgo",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Algo,
            AcceptedAlgo,
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
                            "algo" => Ok(GeneratedField::Algo),
                            "acceptedAlgo" | "accepted_algo" => Ok(GeneratedField::AcceptedAlgo),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RpcCompressionInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.RpcCompressionInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RpcCompressionInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut algo__ = None;
                let mut accepted_algo__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Algo => {
                            if algo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("algo"));
                            }
                            algo__ = Some(map_.next_value::<CompressionAlgoPb>()? as i32);
                        }
                        GeneratedField::AcceptedAlgo => {
                            if accepted_algo__.is_some() {
                                return Err(serde::de::Error::duplicate_field("acceptedAlgo"));
                            }
                            accepted_algo__ = Some(map_.next_value::<CompressionAlgoPb>()? as i32);
                        }
                    }
                }
                Ok(RpcCompressionInfo {
                    algo: algo__.unwrap_or_default(),
                    accepted_algo: accepted_algo__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.RpcCompressionInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RpcDescriptor {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.domain_name.is_empty() {
            len += 1;
        }
        if !self.proto_name.is_empty() {
            len += 1;
        }
        if !self.service_name.is_empty() {
            len += 1;
        }
        if self.method_index != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.RpcDescriptor", len)?;
        if !self.domain_name.is_empty() {
            struct_ser.serialize_field("domain_name", &self.domain_name)?;
        }
        if !self.proto_name.is_empty() {
            struct_ser.serialize_field("proto_name", &self.proto_name)?;
        }
        if !self.service_name.is_empty() {
            struct_ser.serialize_field("service_name", &self.service_name)?;
        }
        if self.method_index != 0 {
            struct_ser.serialize_field("method_index", &self.method_index)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RpcDescriptor {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "domain_name",
            "domainName",
            "proto_name",
            "protoName",
            "service_name",
            "serviceName",
            "method_index",
            "methodIndex",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            DomainName,
            ProtoName,
            ServiceName,
            MethodIndex,
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
                            "domainName" | "domain_name" => Ok(GeneratedField::DomainName),
                            "protoName" | "proto_name" => Ok(GeneratedField::ProtoName),
                            "serviceName" | "service_name" => Ok(GeneratedField::ServiceName),
                            "methodIndex" | "method_index" => Ok(GeneratedField::MethodIndex),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RpcDescriptor;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.RpcDescriptor")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RpcDescriptor, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut domain_name__ = None;
                let mut proto_name__ = None;
                let mut service_name__ = None;
                let mut method_index__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::DomainName => {
                            if domain_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("domainName"));
                            }
                            domain_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ProtoName => {
                            if proto_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("protoName"));
                            }
                            proto_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ServiceName => {
                            if service_name__.is_some() {
                                return Err(serde::de::Error::duplicate_field("serviceName"));
                            }
                            service_name__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MethodIndex => {
                            if method_index__.is_some() {
                                return Err(serde::de::Error::duplicate_field("methodIndex"));
                            }
                            method_index__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(RpcDescriptor {
                    domain_name: domain_name__.unwrap_or_default(),
                    proto_name: proto_name__.unwrap_or_default(),
                    service_name: service_name__.unwrap_or_default(),
                    method_index: method_index__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.RpcDescriptor", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RpcPacket {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.from_peer != 0 {
            len += 1;
        }
        if self.to_peer != 0 {
            len += 1;
        }
        if self.transaction_id != 0 {
            len += 1;
        }
        if self.descriptor.is_some() {
            len += 1;
        }
        if !self.body.is_empty() {
            len += 1;
        }
        if self.is_request {
            len += 1;
        }
        if self.total_pieces != 0 {
            len += 1;
        }
        if self.piece_idx != 0 {
            len += 1;
        }
        if self.trace_id != 0 {
            len += 1;
        }
        if self.compression_info.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.RpcPacket", len)?;
        if self.from_peer != 0 {
            struct_ser.serialize_field("from_peer", &self.from_peer)?;
        }
        if self.to_peer != 0 {
            struct_ser.serialize_field("to_peer", &self.to_peer)?;
        }
        if self.transaction_id != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("transaction_id", ToString::to_string(&self.transaction_id).as_str())?;
        }
        if let Some(v) = self.descriptor.as_ref() {
            struct_ser.serialize_field("descriptor", v)?;
        }
        if !self.body.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("body", pbjson::private::base64::encode(&self.body).as_str())?;
        }
        if self.is_request {
            struct_ser.serialize_field("is_request", &self.is_request)?;
        }
        if self.total_pieces != 0 {
            struct_ser.serialize_field("total_pieces", &self.total_pieces)?;
        }
        if self.piece_idx != 0 {
            struct_ser.serialize_field("piece_idx", &self.piece_idx)?;
        }
        if self.trace_id != 0 {
            struct_ser.serialize_field("trace_id", &self.trace_id)?;
        }
        if let Some(v) = self.compression_info.as_ref() {
            struct_ser.serialize_field("compression_info", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RpcPacket {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "from_peer",
            "fromPeer",
            "to_peer",
            "toPeer",
            "transaction_id",
            "transactionId",
            "descriptor",
            "body",
            "is_request",
            "isRequest",
            "total_pieces",
            "totalPieces",
            "piece_idx",
            "pieceIdx",
            "trace_id",
            "traceId",
            "compression_info",
            "compressionInfo",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            FromPeer,
            ToPeer,
            TransactionId,
            Descriptor,
            Body,
            IsRequest,
            TotalPieces,
            PieceIdx,
            TraceId,
            CompressionInfo,
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
                            "fromPeer" | "from_peer" => Ok(GeneratedField::FromPeer),
                            "toPeer" | "to_peer" => Ok(GeneratedField::ToPeer),
                            "transactionId" | "transaction_id" => Ok(GeneratedField::TransactionId),
                            "descriptor" => Ok(GeneratedField::Descriptor),
                            "body" => Ok(GeneratedField::Body),
                            "isRequest" | "is_request" => Ok(GeneratedField::IsRequest),
                            "totalPieces" | "total_pieces" => Ok(GeneratedField::TotalPieces),
                            "pieceIdx" | "piece_idx" => Ok(GeneratedField::PieceIdx),
                            "traceId" | "trace_id" => Ok(GeneratedField::TraceId),
                            "compressionInfo" | "compression_info" => Ok(GeneratedField::CompressionInfo),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RpcPacket;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.RpcPacket")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RpcPacket, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut from_peer__ = None;
                let mut to_peer__ = None;
                let mut transaction_id__ = None;
                let mut descriptor__ = None;
                let mut body__ = None;
                let mut is_request__ = None;
                let mut total_pieces__ = None;
                let mut piece_idx__ = None;
                let mut trace_id__ = None;
                let mut compression_info__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::FromPeer => {
                            if from_peer__.is_some() {
                                return Err(serde::de::Error::duplicate_field("fromPeer"));
                            }
                            from_peer__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::ToPeer => {
                            if to_peer__.is_some() {
                                return Err(serde::de::Error::duplicate_field("toPeer"));
                            }
                            to_peer__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TransactionId => {
                            if transaction_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("transactionId"));
                            }
                            transaction_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Descriptor => {
                            if descriptor__.is_some() {
                                return Err(serde::de::Error::duplicate_field("descriptor"));
                            }
                            descriptor__ = map_.next_value()?;
                        }
                        GeneratedField::Body => {
                            if body__.is_some() {
                                return Err(serde::de::Error::duplicate_field("body"));
                            }
                            body__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::IsRequest => {
                            if is_request__.is_some() {
                                return Err(serde::de::Error::duplicate_field("isRequest"));
                            }
                            is_request__ = Some(map_.next_value()?);
                        }
                        GeneratedField::TotalPieces => {
                            if total_pieces__.is_some() {
                                return Err(serde::de::Error::duplicate_field("totalPieces"));
                            }
                            total_pieces__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PieceIdx => {
                            if piece_idx__.is_some() {
                                return Err(serde::de::Error::duplicate_field("pieceIdx"));
                            }
                            piece_idx__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TraceId => {
                            if trace_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("traceId"));
                            }
                            trace_id__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::CompressionInfo => {
                            if compression_info__.is_some() {
                                return Err(serde::de::Error::duplicate_field("compressionInfo"));
                            }
                            compression_info__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RpcPacket {
                    from_peer: from_peer__.unwrap_or_default(),
                    to_peer: to_peer__.unwrap_or_default(),
                    transaction_id: transaction_id__.unwrap_or_default(),
                    descriptor: descriptor__,
                    body: body__.unwrap_or_default(),
                    is_request: is_request__.unwrap_or_default(),
                    total_pieces: total_pieces__.unwrap_or_default(),
                    piece_idx: piece_idx__.unwrap_or_default(),
                    trace_id: trace_id__.unwrap_or_default(),
                    compression_info: compression_info__,
                })
            }
        }
        deserializer.deserialize_struct("common.RpcPacket", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RpcRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.descriptor.is_some() {
            len += 1;
        }
        if !self.request.is_empty() {
            len += 1;
        }
        if self.timeout_ms != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.RpcRequest", len)?;
        if let Some(v) = self.descriptor.as_ref() {
            struct_ser.serialize_field("descriptor", v)?;
        }
        if !self.request.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("request", pbjson::private::base64::encode(&self.request).as_str())?;
        }
        if self.timeout_ms != 0 {
            struct_ser.serialize_field("timeout_ms", &self.timeout_ms)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RpcRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "descriptor",
            "request",
            "timeout_ms",
            "timeoutMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Descriptor,
            Request,
            TimeoutMs,
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
                            "descriptor" => Ok(GeneratedField::Descriptor),
                            "request" => Ok(GeneratedField::Request),
                            "timeoutMs" | "timeout_ms" => Ok(GeneratedField::TimeoutMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RpcRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.RpcRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RpcRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut descriptor__ = None;
                let mut request__ = None;
                let mut timeout_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Descriptor => {
                            if descriptor__.is_some() {
                                return Err(serde::de::Error::duplicate_field("descriptor"));
                            }
                            descriptor__ = map_.next_value()?;
                        }
                        GeneratedField::Request => {
                            if request__.is_some() {
                                return Err(serde::de::Error::duplicate_field("request"));
                            }
                            request__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::TimeoutMs => {
                            if timeout_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("timeoutMs"));
                            }
                            timeout_ms__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(RpcRequest {
                    descriptor: descriptor__,
                    request: request__.unwrap_or_default(),
                    timeout_ms: timeout_ms__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.RpcRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RpcResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.response.is_empty() {
            len += 1;
        }
        if self.error.is_some() {
            len += 1;
        }
        if self.runtime_us != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.RpcResponse", len)?;
        if !self.response.is_empty() {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("response", pbjson::private::base64::encode(&self.response).as_str())?;
        }
        if let Some(v) = self.error.as_ref() {
            struct_ser.serialize_field("error", v)?;
        }
        if self.runtime_us != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("runtime_us", ToString::to_string(&self.runtime_us).as_str())?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RpcResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "response",
            "error",
            "runtime_us",
            "runtimeUs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Response,
            Error,
            RuntimeUs,
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
                            "response" => Ok(GeneratedField::Response),
                            "error" => Ok(GeneratedField::Error),
                            "runtimeUs" | "runtime_us" => Ok(GeneratedField::RuntimeUs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RpcResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.RpcResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RpcResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut response__ = None;
                let mut error__ = None;
                let mut runtime_us__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Response => {
                            if response__.is_some() {
                                return Err(serde::de::Error::duplicate_field("response"));
                            }
                            response__ = 
                                Some(map_.next_value::<::pbjson::private::BytesDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Error => {
                            if error__.is_some() {
                                return Err(serde::de::Error::duplicate_field("error"));
                            }
                            error__ = map_.next_value()?;
                        }
                        GeneratedField::RuntimeUs => {
                            if runtime_us__.is_some() {
                                return Err(serde::de::Error::duplicate_field("runtimeUs"));
                            }
                            runtime_us__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(RpcResponse {
                    response: response__.unwrap_or_default(),
                    error: error__,
                    runtime_us: runtime_us__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.RpcResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SecureModeConfig {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.enabled {
            len += 1;
        }
        if self.local_private_key.is_some() {
            len += 1;
        }
        if self.local_public_key.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.SecureModeConfig", len)?;
        if self.enabled {
            struct_ser.serialize_field("enabled", &self.enabled)?;
        }
        if let Some(v) = self.local_private_key.as_ref() {
            struct_ser.serialize_field("local_private_key", v)?;
        }
        if let Some(v) = self.local_public_key.as_ref() {
            struct_ser.serialize_field("local_public_key", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SecureModeConfig {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "enabled",
            "local_private_key",
            "localPrivateKey",
            "local_public_key",
            "localPublicKey",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Enabled,
            LocalPrivateKey,
            LocalPublicKey,
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
                            "enabled" => Ok(GeneratedField::Enabled),
                            "localPrivateKey" | "local_private_key" => Ok(GeneratedField::LocalPrivateKey),
                            "localPublicKey" | "local_public_key" => Ok(GeneratedField::LocalPublicKey),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SecureModeConfig;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.SecureModeConfig")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SecureModeConfig, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut enabled__ = None;
                let mut local_private_key__ = None;
                let mut local_public_key__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Enabled => {
                            if enabled__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enabled"));
                            }
                            enabled__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LocalPrivateKey => {
                            if local_private_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("localPrivateKey"));
                            }
                            local_private_key__ = map_.next_value()?;
                        }
                        GeneratedField::LocalPublicKey => {
                            if local_public_key__.is_some() {
                                return Err(serde::de::Error::duplicate_field("localPublicKey"));
                            }
                            local_public_key__ = map_.next_value()?;
                        }
                    }
                }
                Ok(SecureModeConfig {
                    enabled: enabled__.unwrap_or_default(),
                    local_private_key: local_private_key__,
                    local_public_key: local_public_key__,
                })
            }
        }
        deserializer.deserialize_struct("common.SecureModeConfig", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SocketAddr {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.port != 0 {
            len += 1;
        }
        if self.ip.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.SocketAddr", len)?;
        if self.port != 0 {
            struct_ser.serialize_field("port", &self.port)?;
        }
        if let Some(v) = self.ip.as_ref() {
            match v {
                socket_addr::Ip::Ipv4(v) => {
                    struct_ser.serialize_field("ipv4", v)?;
                }
                socket_addr::Ip::Ipv6(v) => {
                    struct_ser.serialize_field("ipv6", v)?;
                }
            }
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for SocketAddr {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "port",
            "ipv4",
            "ipv6",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Port,
            Ipv4,
            Ipv6,
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
                            "port" => Ok(GeneratedField::Port),
                            "ipv4" => Ok(GeneratedField::Ipv4),
                            "ipv6" => Ok(GeneratedField::Ipv6),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = SocketAddr;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.SocketAddr")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<SocketAddr, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut port__ = None;
                let mut ip__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Port => {
                            if port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("port"));
                            }
                            port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Ipv4 => {
                            if ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv4"));
                            }
                            ip__ = map_.next_value::<::std::option::Option<_>>()?.map(socket_addr::Ip::Ipv4)
;
                        }
                        GeneratedField::Ipv6 => {
                            if ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("ipv6"));
                            }
                            ip__ = map_.next_value::<::std::option::Option<_>>()?.map(socket_addr::Ip::Ipv6)
;
                        }
                    }
                }
                Ok(SocketAddr {
                    port: port__.unwrap_or_default(),
                    ip: ip__,
                })
            }
        }
        deserializer.deserialize_struct("common.SocketAddr", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for SocketType {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Tcp => "TCP",
            Self::Udp => "UDP",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for SocketType {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "TCP",
            "UDP",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = SocketType;

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
                    "TCP" => Ok(SocketType::Tcp),
                    "UDP" => Ok(SocketType::Udp),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for StunInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.udp_nat_type != 0 {
            len += 1;
        }
        if self.tcp_nat_type != 0 {
            len += 1;
        }
        if self.last_update_time != 0 {
            len += 1;
        }
        if !self.public_ip.is_empty() {
            len += 1;
        }
        if self.min_port != 0 {
            len += 1;
        }
        if self.max_port != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.StunInfo", len)?;
        if self.udp_nat_type != 0 {
            let v = NatType::try_from(self.udp_nat_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.udp_nat_type)))?;
            struct_ser.serialize_field("udp_nat_type", &v)?;
        }
        if self.tcp_nat_type != 0 {
            let v = NatType::try_from(self.tcp_nat_type)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.tcp_nat_type)))?;
            struct_ser.serialize_field("tcp_nat_type", &v)?;
        }
        if self.last_update_time != 0 {
            #[allow(clippy::needless_borrow)]
            #[allow(clippy::needless_borrows_for_generic_args)]
            struct_ser.serialize_field("last_update_time", ToString::to_string(&self.last_update_time).as_str())?;
        }
        if !self.public_ip.is_empty() {
            struct_ser.serialize_field("public_ip", &self.public_ip)?;
        }
        if self.min_port != 0 {
            struct_ser.serialize_field("min_port", &self.min_port)?;
        }
        if self.max_port != 0 {
            struct_ser.serialize_field("max_port", &self.max_port)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for StunInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "udp_nat_type",
            "udpNatType",
            "tcp_nat_type",
            "tcpNatType",
            "last_update_time",
            "lastUpdateTime",
            "public_ip",
            "publicIp",
            "min_port",
            "minPort",
            "max_port",
            "maxPort",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            UdpNatType,
            TcpNatType,
            LastUpdateTime,
            PublicIp,
            MinPort,
            MaxPort,
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
                            "udpNatType" | "udp_nat_type" => Ok(GeneratedField::UdpNatType),
                            "tcpNatType" | "tcp_nat_type" => Ok(GeneratedField::TcpNatType),
                            "lastUpdateTime" | "last_update_time" => Ok(GeneratedField::LastUpdateTime),
                            "publicIp" | "public_ip" => Ok(GeneratedField::PublicIp),
                            "minPort" | "min_port" => Ok(GeneratedField::MinPort),
                            "maxPort" | "max_port" => Ok(GeneratedField::MaxPort),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = StunInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.StunInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<StunInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut udp_nat_type__ = None;
                let mut tcp_nat_type__ = None;
                let mut last_update_time__ = None;
                let mut public_ip__ = None;
                let mut min_port__ = None;
                let mut max_port__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::UdpNatType => {
                            if udp_nat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("udpNatType"));
                            }
                            udp_nat_type__ = Some(map_.next_value::<NatType>()? as i32);
                        }
                        GeneratedField::TcpNatType => {
                            if tcp_nat_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tcpNatType"));
                            }
                            tcp_nat_type__ = Some(map_.next_value::<NatType>()? as i32);
                        }
                        GeneratedField::LastUpdateTime => {
                            if last_update_time__.is_some() {
                                return Err(serde::de::Error::duplicate_field("lastUpdateTime"));
                            }
                            last_update_time__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::PublicIp => {
                            if public_ip__.is_some() {
                                return Err(serde::de::Error::duplicate_field("publicIp"));
                            }
                            public_ip__ = Some(map_.next_value()?);
                        }
                        GeneratedField::MinPort => {
                            if min_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("minPort"));
                            }
                            min_port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::MaxPort => {
                            if max_port__.is_some() {
                                return Err(serde::de::Error::duplicate_field("maxPort"));
                            }
                            max_port__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(StunInfo {
                    udp_nat_type: udp_nat_type__.unwrap_or_default(),
                    tcp_nat_type: tcp_nat_type__.unwrap_or_default(),
                    last_update_time: last_update_time__.unwrap_or_default(),
                    public_ip: public_ip__.unwrap_or_default(),
                    min_port: min_port__.unwrap_or_default(),
                    max_port: max_port__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.StunInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for TunnelInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.tunnel_type.is_empty() {
            len += 1;
        }
        if self.local_addr.is_some() {
            len += 1;
        }
        if self.remote_addr.is_some() {
            len += 1;
        }
        if self.resolved_remote_addr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.TunnelInfo", len)?;
        if !self.tunnel_type.is_empty() {
            struct_ser.serialize_field("tunnel_type", &self.tunnel_type)?;
        }
        if let Some(v) = self.local_addr.as_ref() {
            struct_ser.serialize_field("local_addr", v)?;
        }
        if let Some(v) = self.remote_addr.as_ref() {
            struct_ser.serialize_field("remote_addr", v)?;
        }
        if let Some(v) = self.resolved_remote_addr.as_ref() {
            struct_ser.serialize_field("resolved_remote_addr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for TunnelInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "tunnel_type",
            "tunnelType",
            "local_addr",
            "localAddr",
            "remote_addr",
            "remoteAddr",
            "resolved_remote_addr",
            "resolvedRemoteAddr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            TunnelType,
            LocalAddr,
            RemoteAddr,
            ResolvedRemoteAddr,
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
                            "tunnelType" | "tunnel_type" => Ok(GeneratedField::TunnelType),
                            "localAddr" | "local_addr" => Ok(GeneratedField::LocalAddr),
                            "remoteAddr" | "remote_addr" => Ok(GeneratedField::RemoteAddr),
                            "resolvedRemoteAddr" | "resolved_remote_addr" => Ok(GeneratedField::ResolvedRemoteAddr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = TunnelInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.TunnelInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<TunnelInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut tunnel_type__ = None;
                let mut local_addr__ = None;
                let mut remote_addr__ = None;
                let mut resolved_remote_addr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::TunnelType => {
                            if tunnel_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tunnelType"));
                            }
                            tunnel_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::LocalAddr => {
                            if local_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("localAddr"));
                            }
                            local_addr__ = map_.next_value()?;
                        }
                        GeneratedField::RemoteAddr => {
                            if remote_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("remoteAddr"));
                            }
                            remote_addr__ = map_.next_value()?;
                        }
                        GeneratedField::ResolvedRemoteAddr => {
                            if resolved_remote_addr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("resolvedRemoteAddr"));
                            }
                            resolved_remote_addr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(TunnelInfo {
                    tunnel_type: tunnel_type__.unwrap_or_default(),
                    local_addr: local_addr__,
                    remote_addr: remote_addr__,
                    resolved_remote_addr: resolved_remote_addr__,
                })
            }
        }
        deserializer.deserialize_struct("common.TunnelInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Uuid {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.part1 != 0 {
            len += 1;
        }
        if self.part2 != 0 {
            len += 1;
        }
        if self.part3 != 0 {
            len += 1;
        }
        if self.part4 != 0 {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.UUID", len)?;
        if self.part1 != 0 {
            struct_ser.serialize_field("part1", &self.part1)?;
        }
        if self.part2 != 0 {
            struct_ser.serialize_field("part2", &self.part2)?;
        }
        if self.part3 != 0 {
            struct_ser.serialize_field("part3", &self.part3)?;
        }
        if self.part4 != 0 {
            struct_ser.serialize_field("part4", &self.part4)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Uuid {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "part1",
            "part2",
            "part3",
            "part4",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Part1,
            Part2,
            Part3,
            Part4,
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
                            "part1" => Ok(GeneratedField::Part1),
                            "part2" => Ok(GeneratedField::Part2),
                            "part3" => Ok(GeneratedField::Part3),
                            "part4" => Ok(GeneratedField::Part4),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = Uuid;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.UUID")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Uuid, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut part1__ = None;
                let mut part2__ = None;
                let mut part3__ = None;
                let mut part4__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Part1 => {
                            if part1__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part1"));
                            }
                            part1__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Part2 => {
                            if part2__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part2"));
                            }
                            part2__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Part3 => {
                            if part3__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part3"));
                            }
                            part3__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                        GeneratedField::Part4 => {
                            if part4__.is_some() {
                                return Err(serde::de::Error::duplicate_field("part4"));
                            }
                            part4__ = 
                                Some(map_.next_value::<::pbjson::private::NumberDeserialize<_>>()?.0)
                            ;
                        }
                    }
                }
                Ok(Uuid {
                    part1: part1__.unwrap_or_default(),
                    part2: part2__.unwrap_or_default(),
                    part3: part3__.unwrap_or_default(),
                    part4: part4__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.UUID", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Url {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.url.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("common.Url", len)?;
        if !self.url.is_empty() {
            struct_ser.serialize_field("url", &self.url)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Url {
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
            type Value = Url;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Url")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Url, V::Error>
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
                            url__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(Url {
                    url: url__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("common.Url", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for Void {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("common.Void", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for Void {
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
            type Value = Void;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct common.Void")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<Void, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(Void {
                })
            }
        }
        deserializer.deserialize_struct("common.Void", FIELDS, GeneratedVisitor)
    }
}
