impl serde::Serialize for AclPatch {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.acl.is_some() {
            len += 1;
        }
        if !self.tcp_whitelist.is_empty() {
            len += 1;
        }
        if !self.udp_whitelist.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.AclPatch", len)?;
        if let Some(v) = self.acl.as_ref() {
            struct_ser.serialize_field("acl", v)?;
        }
        if !self.tcp_whitelist.is_empty() {
            struct_ser.serialize_field("tcp_whitelist", &self.tcp_whitelist)?;
        }
        if !self.udp_whitelist.is_empty() {
            struct_ser.serialize_field("udp_whitelist", &self.udp_whitelist)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for AclPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "acl",
            "tcp_whitelist",
            "tcpWhitelist",
            "udp_whitelist",
            "udpWhitelist",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Acl,
            TcpWhitelist,
            UdpWhitelist,
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
                            "acl" => Ok(GeneratedField::Acl),
                            "tcpWhitelist" | "tcp_whitelist" => Ok(GeneratedField::TcpWhitelist),
                            "udpWhitelist" | "udp_whitelist" => Ok(GeneratedField::UdpWhitelist),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = AclPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.AclPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<AclPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut acl__ = None;
                let mut tcp_whitelist__ = None;
                let mut udp_whitelist__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Acl => {
                            if acl__.is_some() {
                                return Err(serde::de::Error::duplicate_field("acl"));
                            }
                            acl__ = map_.next_value()?;
                        }
                        GeneratedField::TcpWhitelist => {
                            if tcp_whitelist__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tcpWhitelist"));
                            }
                            tcp_whitelist__ = Some(map_.next_value()?);
                        }
                        GeneratedField::UdpWhitelist => {
                            if udp_whitelist__.is_some() {
                                return Err(serde::de::Error::duplicate_field("udpWhitelist"));
                            }
                            udp_whitelist__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(AclPatch {
                    acl: acl__,
                    tcp_whitelist: tcp_whitelist__.unwrap_or_default(),
                    udp_whitelist: udp_whitelist__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.config.AclPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ConfigPatchAction {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let variant = match self {
            Self::Add => "ADD",
            Self::Remove => "REMOVE",
            Self::Clear => "CLEAR",
        };
        serializer.serialize_str(variant)
    }
}
impl<'de> serde::Deserialize<'de> for ConfigPatchAction {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "ADD",
            "REMOVE",
            "CLEAR",
        ];

        struct GeneratedVisitor;

        impl serde::de::Visitor<'_> for GeneratedVisitor {
            type Value = ConfigPatchAction;

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
                    "ADD" => Ok(ConfigPatchAction::Add),
                    "REMOVE" => Ok(ConfigPatchAction::Remove),
                    "CLEAR" => Ok(ConfigPatchAction::Clear),
                    _ => Err(serde::de::Error::unknown_variant(value, FIELDS)),
                }
            }
        }
        deserializer.deserialize_any(GeneratedVisitor)
    }
}
impl serde::Serialize for ExitNodePatch {
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
        if self.node.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.ExitNodePatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if let Some(v) = self.node.as_ref() {
            struct_ser.serialize_field("node", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ExitNodePatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "node",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
            Node,
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
                            "node" => Ok(GeneratedField::Node),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ExitNodePatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.ExitNodePatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ExitNodePatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut node__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Node => {
                            if node__.is_some() {
                                return Err(serde::de::Error::duplicate_field("node"));
                            }
                            node__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ExitNodePatch {
                    action: action__.unwrap_or_default(),
                    node: node__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.ExitNodePatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetConfigRequest {
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
        let mut struct_ser = serializer.serialize_struct("api.config.GetConfigRequest", len)?;
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetConfigRequest {
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
            type Value = GetConfigRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.GetConfigRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetConfigRequest, V::Error>
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
                Ok(GetConfigRequest {
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.GetConfigRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetConfigResponse {
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
        if !self.toml_config.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.GetConfigResponse", len)?;
        if let Some(v) = self.config.as_ref() {
            struct_ser.serialize_field("config", v)?;
        }
        if !self.toml_config.is_empty() {
            struct_ser.serialize_field("toml_config", &self.toml_config)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetConfigResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "config",
            "toml_config",
            "tomlConfig",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Config,
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
                            "config" => Ok(GeneratedField::Config),
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
            type Value = GetConfigResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.GetConfigResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetConfigResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut config__ = None;
                let mut toml_config__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Config => {
                            if config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("config"));
                            }
                            config__ = map_.next_value()?;
                        }
                        GeneratedField::TomlConfig => {
                            if toml_config__.is_some() {
                                return Err(serde::de::Error::duplicate_field("tomlConfig"));
                            }
                            toml_config__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetConfigResponse {
                    config: config__,
                    toml_config: toml_config__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.config.GetConfigResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for InstanceConfigPatch {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.hostname.is_some() {
            len += 1;
        }
        if self.ipv4.is_some() {
            len += 1;
        }
        if self.ipv6.is_some() {
            len += 1;
        }
        if !self.port_forwards.is_empty() {
            len += 1;
        }
        if self.acl.is_some() {
            len += 1;
        }
        if !self.proxy_networks.is_empty() {
            len += 1;
        }
        if !self.routes.is_empty() {
            len += 1;
        }
        if !self.exit_nodes.is_empty() {
            len += 1;
        }
        if !self.mapped_listeners.is_empty() {
            len += 1;
        }
        if !self.connectors.is_empty() {
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
        if !self.vpn_portal_clients.is_empty() {
            len += 1;
        }
        if self.managed_credentials.is_some() {
            len += 1;
        }
        if self.prefer_peer_relay.is_some() {
            len += 1;
        }
        if self.enable_manual_routes.is_some() {
            len += 1;
        }
        if self.dns.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.InstanceConfigPatch", len)?;
        if let Some(v) = self.hostname.as_ref() {
            struct_ser.serialize_field("hostname", v)?;
        }
        if let Some(v) = self.ipv4.as_ref() {
            struct_ser.serialize_field("ipv4", v)?;
        }
        if let Some(v) = self.ipv6.as_ref() {
            struct_ser.serialize_field("ipv6", v)?;
        }
        if !self.port_forwards.is_empty() {
            struct_ser.serialize_field("port_forwards", &self.port_forwards)?;
        }
        if let Some(v) = self.acl.as_ref() {
            struct_ser.serialize_field("acl", v)?;
        }
        if !self.proxy_networks.is_empty() {
            struct_ser.serialize_field("proxy_networks", &self.proxy_networks)?;
        }
        if !self.routes.is_empty() {
            struct_ser.serialize_field("routes", &self.routes)?;
        }
        if !self.exit_nodes.is_empty() {
            struct_ser.serialize_field("exit_nodes", &self.exit_nodes)?;
        }
        if !self.mapped_listeners.is_empty() {
            struct_ser.serialize_field("mapped_listeners", &self.mapped_listeners)?;
        }
        if !self.connectors.is_empty() {
            struct_ser.serialize_field("connectors", &self.connectors)?;
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
        if !self.vpn_portal_clients.is_empty() {
            struct_ser.serialize_field("vpn_portal_clients", &self.vpn_portal_clients)?;
        }
        if let Some(v) = self.managed_credentials.as_ref() {
            struct_ser.serialize_field("managed_credentials", v)?;
        }
        if let Some(v) = self.prefer_peer_relay.as_ref() {
            struct_ser.serialize_field("prefer_peer_relay", v)?;
        }
        if let Some(v) = self.enable_manual_routes.as_ref() {
            struct_ser.serialize_field("enable_manual_routes", v)?;
        }
        if let Some(v) = self.dns.as_ref() {
            struct_ser.serialize_field("dns", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for InstanceConfigPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "hostname",
            "ipv4",
            "ipv6",
            "port_forwards",
            "portForwards",
            "acl",
            "proxy_networks",
            "proxyNetworks",
            "routes",
            "exit_nodes",
            "exitNodes",
            "mapped_listeners",
            "mappedListeners",
            "connectors",
            "ipv6_public_addr_provider",
            "ipv6PublicAddrProvider",
            "ipv6_public_addr_auto",
            "ipv6PublicAddrAuto",
            "ipv6_public_addr_prefix",
            "ipv6PublicAddrPrefix",
            "disable_relay_data",
            "disableRelayData",
            "vpn_portal_clients",
            "vpnPortalClients",
            "managed_credentials",
            "managedCredentials",
            "prefer_peer_relay",
            "preferPeerRelay",
            "enable_manual_routes",
            "enableManualRoutes",
            "dns",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Hostname,
            Ipv4,
            Ipv6,
            PortForwards,
            Acl,
            ProxyNetworks,
            Routes,
            ExitNodes,
            MappedListeners,
            Connectors,
            Ipv6PublicAddrProvider,
            Ipv6PublicAddrAuto,
            Ipv6PublicAddrPrefix,
            DisableRelayData,
            VpnPortalClients,
            ManagedCredentials,
            PreferPeerRelay,
            EnableManualRoutes,
            Dns,
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
                            "hostname" => Ok(GeneratedField::Hostname),
                            "ipv4" => Ok(GeneratedField::Ipv4),
                            "ipv6" => Ok(GeneratedField::Ipv6),
                            "portForwards" | "port_forwards" => Ok(GeneratedField::PortForwards),
                            "acl" => Ok(GeneratedField::Acl),
                            "proxyNetworks" | "proxy_networks" => Ok(GeneratedField::ProxyNetworks),
                            "routes" => Ok(GeneratedField::Routes),
                            "exitNodes" | "exit_nodes" => Ok(GeneratedField::ExitNodes),
                            "mappedListeners" | "mapped_listeners" => Ok(GeneratedField::MappedListeners),
                            "connectors" => Ok(GeneratedField::Connectors),
                            "ipv6PublicAddrProvider" | "ipv6_public_addr_provider" => Ok(GeneratedField::Ipv6PublicAddrProvider),
                            "ipv6PublicAddrAuto" | "ipv6_public_addr_auto" => Ok(GeneratedField::Ipv6PublicAddrAuto),
                            "ipv6PublicAddrPrefix" | "ipv6_public_addr_prefix" => Ok(GeneratedField::Ipv6PublicAddrPrefix),
                            "disableRelayData" | "disable_relay_data" => Ok(GeneratedField::DisableRelayData),
                            "vpnPortalClients" | "vpn_portal_clients" => Ok(GeneratedField::VpnPortalClients),
                            "managedCredentials" | "managed_credentials" => Ok(GeneratedField::ManagedCredentials),
                            "preferPeerRelay" | "prefer_peer_relay" => Ok(GeneratedField::PreferPeerRelay),
                            "enableManualRoutes" | "enable_manual_routes" => Ok(GeneratedField::EnableManualRoutes),
                            "dns" => Ok(GeneratedField::Dns),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = InstanceConfigPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.InstanceConfigPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<InstanceConfigPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut hostname__ = None;
                let mut ipv4__ = None;
                let mut ipv6__ = None;
                let mut port_forwards__ = None;
                let mut acl__ = None;
                let mut proxy_networks__ = None;
                let mut routes__ = None;
                let mut exit_nodes__ = None;
                let mut mapped_listeners__ = None;
                let mut connectors__ = None;
                let mut ipv6_public_addr_provider__ = None;
                let mut ipv6_public_addr_auto__ = None;
                let mut ipv6_public_addr_prefix__ = None;
                let mut disable_relay_data__ = None;
                let mut vpn_portal_clients__ = None;
                let mut managed_credentials__ = None;
                let mut prefer_peer_relay__ = None;
                let mut enable_manual_routes__ = None;
                let mut dns__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Hostname => {
                            if hostname__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hostname"));
                            }
                            hostname__ = map_.next_value()?;
                        }
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
                        GeneratedField::PortForwards => {
                            if port_forwards__.is_some() {
                                return Err(serde::de::Error::duplicate_field("portForwards"));
                            }
                            port_forwards__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Acl => {
                            if acl__.is_some() {
                                return Err(serde::de::Error::duplicate_field("acl"));
                            }
                            acl__ = map_.next_value()?;
                        }
                        GeneratedField::ProxyNetworks => {
                            if proxy_networks__.is_some() {
                                return Err(serde::de::Error::duplicate_field("proxyNetworks"));
                            }
                            proxy_networks__ = Some(map_.next_value()?);
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
                        GeneratedField::MappedListeners => {
                            if mapped_listeners__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mappedListeners"));
                            }
                            mapped_listeners__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Connectors => {
                            if connectors__.is_some() {
                                return Err(serde::de::Error::duplicate_field("connectors"));
                            }
                            connectors__ = Some(map_.next_value()?);
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
                        GeneratedField::VpnPortalClients => {
                            if vpn_portal_clients__.is_some() {
                                return Err(serde::de::Error::duplicate_field("vpnPortalClients"));
                            }
                            vpn_portal_clients__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ManagedCredentials => {
                            if managed_credentials__.is_some() {
                                return Err(serde::de::Error::duplicate_field("managedCredentials"));
                            }
                            managed_credentials__ = map_.next_value()?;
                        }
                        GeneratedField::PreferPeerRelay => {
                            if prefer_peer_relay__.is_some() {
                                return Err(serde::de::Error::duplicate_field("preferPeerRelay"));
                            }
                            prefer_peer_relay__ = map_.next_value()?;
                        }
                        GeneratedField::EnableManualRoutes => {
                            if enable_manual_routes__.is_some() {
                                return Err(serde::de::Error::duplicate_field("enableManualRoutes"));
                            }
                            enable_manual_routes__ = map_.next_value()?;
                        }
                        GeneratedField::Dns => {
                            if dns__.is_some() {
                                return Err(serde::de::Error::duplicate_field("dns"));
                            }
                            dns__ = map_.next_value()?;
                        }
                    }
                }
                Ok(InstanceConfigPatch {
                    hostname: hostname__,
                    ipv4: ipv4__,
                    ipv6: ipv6__,
                    port_forwards: port_forwards__.unwrap_or_default(),
                    acl: acl__,
                    proxy_networks: proxy_networks__.unwrap_or_default(),
                    routes: routes__.unwrap_or_default(),
                    exit_nodes: exit_nodes__.unwrap_or_default(),
                    mapped_listeners: mapped_listeners__.unwrap_or_default(),
                    connectors: connectors__.unwrap_or_default(),
                    ipv6_public_addr_provider: ipv6_public_addr_provider__,
                    ipv6_public_addr_auto: ipv6_public_addr_auto__,
                    ipv6_public_addr_prefix: ipv6_public_addr_prefix__,
                    disable_relay_data: disable_relay_data__,
                    vpn_portal_clients: vpn_portal_clients__.unwrap_or_default(),
                    managed_credentials: managed_credentials__,
                    prefer_peer_relay: prefer_peer_relay__,
                    enable_manual_routes: enable_manual_routes__,
                    dns: dns__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.InstanceConfigPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PatchConfigRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.patch.is_some() {
            len += 1;
        }
        if self.instance.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.PatchConfigRequest", len)?;
        if let Some(v) = self.patch.as_ref() {
            struct_ser.serialize_field("patch", v)?;
        }
        if let Some(v) = self.instance.as_ref() {
            struct_ser.serialize_field("instance", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PatchConfigRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "patch",
            "instance",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Patch,
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
                            "patch" => Ok(GeneratedField::Patch),
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
            type Value = PatchConfigRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.PatchConfigRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PatchConfigRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut patch__ = None;
                let mut instance__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Patch => {
                            if patch__.is_some() {
                                return Err(serde::de::Error::duplicate_field("patch"));
                            }
                            patch__ = map_.next_value()?;
                        }
                        GeneratedField::Instance => {
                            if instance__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instance"));
                            }
                            instance__ = map_.next_value()?;
                        }
                    }
                }
                Ok(PatchConfigRequest {
                    patch: patch__,
                    instance: instance__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.PatchConfigRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PatchConfigResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("api.config.PatchConfigResponse", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PatchConfigResponse {
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
            type Value = PatchConfigResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.PatchConfigResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PatchConfigResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(PatchConfigResponse {
                })
            }
        }
        deserializer.deserialize_struct("api.config.PatchConfigResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for PortForwardPatch {
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
        if self.cfg.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.PortForwardPatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if let Some(v) = self.cfg.as_ref() {
            struct_ser.serialize_field("cfg", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for PortForwardPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "cfg",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
            Cfg,
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
                            "cfg" => Ok(GeneratedField::Cfg),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = PortForwardPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.PortForwardPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<PortForwardPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut cfg__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Cfg => {
                            if cfg__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cfg"));
                            }
                            cfg__ = map_.next_value()?;
                        }
                    }
                }
                Ok(PortForwardPatch {
                    action: action__.unwrap_or_default(),
                    cfg: cfg__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.PortForwardPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for ProxyNetworkPatch {
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
        if self.cidr.is_some() {
            len += 1;
        }
        if self.mapped_cidr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.ProxyNetworkPatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if let Some(v) = self.cidr.as_ref() {
            struct_ser.serialize_field("cidr", v)?;
        }
        if let Some(v) = self.mapped_cidr.as_ref() {
            struct_ser.serialize_field("mapped_cidr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ProxyNetworkPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "cidr",
            "mapped_cidr",
            "mappedCidr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
            Cidr,
            MappedCidr,
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
                            "cidr" => Ok(GeneratedField::Cidr),
                            "mappedCidr" | "mapped_cidr" => Ok(GeneratedField::MappedCidr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ProxyNetworkPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.ProxyNetworkPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ProxyNetworkPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut cidr__ = None;
                let mut mapped_cidr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Cidr => {
                            if cidr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cidr"));
                            }
                            cidr__ = map_.next_value()?;
                        }
                        GeneratedField::MappedCidr => {
                            if mapped_cidr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("mappedCidr"));
                            }
                            mapped_cidr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(ProxyNetworkPatch {
                    action: action__.unwrap_or_default(),
                    cidr: cidr__,
                    mapped_cidr: mapped_cidr__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.ProxyNetworkPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for RoutePatch {
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
        if self.cidr.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.RoutePatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if let Some(v) = self.cidr.as_ref() {
            struct_ser.serialize_field("cidr", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for RoutePatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "cidr",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
            Cidr,
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
                            "cidr" => Ok(GeneratedField::Cidr),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = RoutePatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.RoutePatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<RoutePatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut cidr__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Cidr => {
                            if cidr__.is_some() {
                                return Err(serde::de::Error::duplicate_field("cidr"));
                            }
                            cidr__ = map_.next_value()?;
                        }
                    }
                }
                Ok(RoutePatch {
                    action: action__.unwrap_or_default(),
                    cidr: cidr__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.RoutePatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for StringPatch {
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
        if !self.value.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.StringPatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if !self.value.is_empty() {
            struct_ser.serialize_field("value", &self.value)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for StringPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "value",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
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
                            "action" => Ok(GeneratedField::Action),
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
            type Value = StringPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.StringPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<StringPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut value__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Value => {
                            if value__.is_some() {
                                return Err(serde::de::Error::duplicate_field("value"));
                            }
                            value__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(StringPatch {
                    action: action__.unwrap_or_default(),
                    value: value__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("api.config.StringPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for UrlPatch {
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
        if self.url.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.UrlPatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if let Some(v) = self.url.as_ref() {
            struct_ser.serialize_field("url", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for UrlPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "url",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
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
                            "action" => Ok(GeneratedField::Action),
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
            type Value = UrlPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.UrlPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<UrlPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut url__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Url => {
                            if url__.is_some() {
                                return Err(serde::de::Error::duplicate_field("url"));
                            }
                            url__ = map_.next_value()?;
                        }
                    }
                }
                Ok(UrlPatch {
                    action: action__.unwrap_or_default(),
                    url: url__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.UrlPatch", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for VpnPortalClientPatch {
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
        if self.client.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("api.config.VpnPortalClientPatch", len)?;
        if self.action != 0 {
            let v = ConfigPatchAction::try_from(self.action)
                .map_err(|_| serde::ser::Error::custom(format!("Invalid variant {}", self.action)))?;
            struct_ser.serialize_field("action", &v)?;
        }
        if let Some(v) = self.client.as_ref() {
            struct_ser.serialize_field("client", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for VpnPortalClientPatch {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "action",
            "client",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Action,
            Client,
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
                            "client" => Ok(GeneratedField::Client),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = VpnPortalClientPatch;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct api.config.VpnPortalClientPatch")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<VpnPortalClientPatch, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut action__ = None;
                let mut client__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Action => {
                            if action__.is_some() {
                                return Err(serde::de::Error::duplicate_field("action"));
                            }
                            action__ = Some(map_.next_value::<ConfigPatchAction>()? as i32);
                        }
                        GeneratedField::Client => {
                            if client__.is_some() {
                                return Err(serde::de::Error::duplicate_field("client"));
                            }
                            client__ = map_.next_value()?;
                        }
                    }
                }
                Ok(VpnPortalClientPatch {
                    action: action__.unwrap_or_default(),
                    client: client__,
                })
            }
        }
        deserializer.deserialize_struct("api.config.VpnPortalClientPatch", FIELDS, GeneratedVisitor)
    }
}
