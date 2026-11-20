impl serde::Serialize for DeviceOsInfo {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.os_type.is_empty() {
            len += 1;
        }
        if !self.version.is_empty() {
            len += 1;
        }
        if !self.distribution.is_empty() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("web.DeviceOsInfo", len)?;
        if !self.os_type.is_empty() {
            struct_ser.serialize_field("os_type", &self.os_type)?;
        }
        if !self.version.is_empty() {
            struct_ser.serialize_field("version", &self.version)?;
        }
        if !self.distribution.is_empty() {
            struct_ser.serialize_field("distribution", &self.distribution)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for DeviceOsInfo {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "os_type",
            "osType",
            "version",
            "distribution",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            OsType,
            Version,
            Distribution,
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
                            "osType" | "os_type" => Ok(GeneratedField::OsType),
                            "version" => Ok(GeneratedField::Version),
                            "distribution" => Ok(GeneratedField::Distribution),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = DeviceOsInfo;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct web.DeviceOsInfo")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<DeviceOsInfo, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut os_type__ = None;
                let mut version__ = None;
                let mut distribution__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::OsType => {
                            if os_type__.is_some() {
                                return Err(serde::de::Error::duplicate_field("osType"));
                            }
                            os_type__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Version => {
                            if version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("version"));
                            }
                            version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Distribution => {
                            if distribution__.is_some() {
                                return Err(serde::de::Error::duplicate_field("distribution"));
                            }
                            distribution__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(DeviceOsInfo {
                    os_type: os_type__.unwrap_or_default(),
                    version: version__.unwrap_or_default(),
                    distribution: distribution__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("web.DeviceOsInfo", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetFeatureRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let len = 0;
        let struct_ser = serializer.serialize_struct("web.GetFeatureRequest", len)?;
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetFeatureRequest {
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
            type Value = GetFeatureRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct web.GetFeatureRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetFeatureRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                while map_.next_key::<GeneratedField>()?.is_some() {
                    let _ = map_.next_value::<serde::de::IgnoredAny>()?;
                }
                Ok(GetFeatureRequest {
                })
            }
        }
        deserializer.deserialize_struct("web.GetFeatureRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for GetFeatureResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.support_encryption {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("web.GetFeatureResponse", len)?;
        if self.support_encryption {
            struct_ser.serialize_field("support_encryption", &self.support_encryption)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for GetFeatureResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "support_encryption",
            "supportEncryption",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            SupportEncryption,
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
                            "supportEncryption" | "support_encryption" => Ok(GeneratedField::SupportEncryption),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = GetFeatureResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct web.GetFeatureResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<GetFeatureResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut support_encryption__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::SupportEncryption => {
                            if support_encryption__.is_some() {
                                return Err(serde::de::Error::duplicate_field("supportEncryption"));
                            }
                            support_encryption__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(GetFeatureResponse {
                    support_encryption: support_encryption__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("web.GetFeatureResponse", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for HeartbeatRequest {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.machine_id.is_some() {
            len += 1;
        }
        if self.inst_id.is_some() {
            len += 1;
        }
        if !self.user_token.is_empty() {
            len += 1;
        }
        if !self.easytier_version.is_empty() {
            len += 1;
        }
        if !self.report_time.is_empty() {
            len += 1;
        }
        if !self.hostname.is_empty() {
            len += 1;
        }
        if !self.running_network_instances.is_empty() {
            len += 1;
        }
        if self.device_os.is_some() {
            len += 1;
        }
        if self.support_config_source {
            len += 1;
        }
        if !self.failed_network_instances.is_empty() {
            len += 1;
        }
        if self.support_heartbeat_policy {
            len += 1;
        }
        if self.support_manual_routes_patch {
            len += 1;
        }
        if self.support_dns_config_patch.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("web.HeartbeatRequest", len)?;
        if let Some(v) = self.machine_id.as_ref() {
            struct_ser.serialize_field("machine_id", v)?;
        }
        if let Some(v) = self.inst_id.as_ref() {
            struct_ser.serialize_field("inst_id", v)?;
        }
        if !self.user_token.is_empty() {
            struct_ser.serialize_field("user_token", &self.user_token)?;
        }
        if !self.easytier_version.is_empty() {
            struct_ser.serialize_field("easytier_version", &self.easytier_version)?;
        }
        if !self.report_time.is_empty() {
            struct_ser.serialize_field("report_time", &self.report_time)?;
        }
        if !self.hostname.is_empty() {
            struct_ser.serialize_field("hostname", &self.hostname)?;
        }
        if !self.running_network_instances.is_empty() {
            struct_ser.serialize_field("running_network_instances", &self.running_network_instances)?;
        }
        if let Some(v) = self.device_os.as_ref() {
            struct_ser.serialize_field("device_os", v)?;
        }
        if self.support_config_source {
            struct_ser.serialize_field("support_config_source", &self.support_config_source)?;
        }
        if !self.failed_network_instances.is_empty() {
            struct_ser.serialize_field("failed_network_instances", &self.failed_network_instances)?;
        }
        if self.support_heartbeat_policy {
            struct_ser.serialize_field("support_heartbeat_policy", &self.support_heartbeat_policy)?;
        }
        if self.support_manual_routes_patch {
            struct_ser.serialize_field("support_manual_routes_patch", &self.support_manual_routes_patch)?;
        }
        if let Some(v) = self.support_dns_config_patch.as_ref() {
            struct_ser.serialize_field("support_dns_config_patch", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for HeartbeatRequest {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "machine_id",
            "machineId",
            "inst_id",
            "instId",
            "user_token",
            "userToken",
            "easytier_version",
            "easytierVersion",
            "report_time",
            "reportTime",
            "hostname",
            "running_network_instances",
            "runningNetworkInstances",
            "device_os",
            "deviceOs",
            "support_config_source",
            "supportConfigSource",
            "failed_network_instances",
            "failedNetworkInstances",
            "support_heartbeat_policy",
            "supportHeartbeatPolicy",
            "support_manual_routes_patch",
            "supportManualRoutesPatch",
            "support_dns_config_patch",
            "supportDnsConfigPatch",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            MachineId,
            InstId,
            UserToken,
            EasytierVersion,
            ReportTime,
            Hostname,
            RunningNetworkInstances,
            DeviceOs,
            SupportConfigSource,
            FailedNetworkInstances,
            SupportHeartbeatPolicy,
            SupportManualRoutesPatch,
            SupportDnsConfigPatch,
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
                            "machineId" | "machine_id" => Ok(GeneratedField::MachineId),
                            "instId" | "inst_id" => Ok(GeneratedField::InstId),
                            "userToken" | "user_token" => Ok(GeneratedField::UserToken),
                            "easytierVersion" | "easytier_version" => Ok(GeneratedField::EasytierVersion),
                            "reportTime" | "report_time" => Ok(GeneratedField::ReportTime),
                            "hostname" => Ok(GeneratedField::Hostname),
                            "runningNetworkInstances" | "running_network_instances" => Ok(GeneratedField::RunningNetworkInstances),
                            "deviceOs" | "device_os" => Ok(GeneratedField::DeviceOs),
                            "supportConfigSource" | "support_config_source" => Ok(GeneratedField::SupportConfigSource),
                            "failedNetworkInstances" | "failed_network_instances" => Ok(GeneratedField::FailedNetworkInstances),
                            "supportHeartbeatPolicy" | "support_heartbeat_policy" => Ok(GeneratedField::SupportHeartbeatPolicy),
                            "supportManualRoutesPatch" | "support_manual_routes_patch" => Ok(GeneratedField::SupportManualRoutesPatch),
                            "supportDnsConfigPatch" | "support_dns_config_patch" => Ok(GeneratedField::SupportDnsConfigPatch),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = HeartbeatRequest;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct web.HeartbeatRequest")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<HeartbeatRequest, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut machine_id__ = None;
                let mut inst_id__ = None;
                let mut user_token__ = None;
                let mut easytier_version__ = None;
                let mut report_time__ = None;
                let mut hostname__ = None;
                let mut running_network_instances__ = None;
                let mut device_os__ = None;
                let mut support_config_source__ = None;
                let mut failed_network_instances__ = None;
                let mut support_heartbeat_policy__ = None;
                let mut support_manual_routes_patch__ = None;
                let mut support_dns_config_patch__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::MachineId => {
                            if machine_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("machineId"));
                            }
                            machine_id__ = map_.next_value()?;
                        }
                        GeneratedField::InstId => {
                            if inst_id__.is_some() {
                                return Err(serde::de::Error::duplicate_field("instId"));
                            }
                            inst_id__ = map_.next_value()?;
                        }
                        GeneratedField::UserToken => {
                            if user_token__.is_some() {
                                return Err(serde::de::Error::duplicate_field("userToken"));
                            }
                            user_token__ = Some(map_.next_value()?);
                        }
                        GeneratedField::EasytierVersion => {
                            if easytier_version__.is_some() {
                                return Err(serde::de::Error::duplicate_field("easytierVersion"));
                            }
                            easytier_version__ = Some(map_.next_value()?);
                        }
                        GeneratedField::ReportTime => {
                            if report_time__.is_some() {
                                return Err(serde::de::Error::duplicate_field("reportTime"));
                            }
                            report_time__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Hostname => {
                            if hostname__.is_some() {
                                return Err(serde::de::Error::duplicate_field("hostname"));
                            }
                            hostname__ = Some(map_.next_value()?);
                        }
                        GeneratedField::RunningNetworkInstances => {
                            if running_network_instances__.is_some() {
                                return Err(serde::de::Error::duplicate_field("runningNetworkInstances"));
                            }
                            running_network_instances__ = Some(map_.next_value()?);
                        }
                        GeneratedField::DeviceOs => {
                            if device_os__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deviceOs"));
                            }
                            device_os__ = map_.next_value()?;
                        }
                        GeneratedField::SupportConfigSource => {
                            if support_config_source__.is_some() {
                                return Err(serde::de::Error::duplicate_field("supportConfigSource"));
                            }
                            support_config_source__ = Some(map_.next_value()?);
                        }
                        GeneratedField::FailedNetworkInstances => {
                            if failed_network_instances__.is_some() {
                                return Err(serde::de::Error::duplicate_field("failedNetworkInstances"));
                            }
                            failed_network_instances__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SupportHeartbeatPolicy => {
                            if support_heartbeat_policy__.is_some() {
                                return Err(serde::de::Error::duplicate_field("supportHeartbeatPolicy"));
                            }
                            support_heartbeat_policy__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SupportManualRoutesPatch => {
                            if support_manual_routes_patch__.is_some() {
                                return Err(serde::de::Error::duplicate_field("supportManualRoutesPatch"));
                            }
                            support_manual_routes_patch__ = Some(map_.next_value()?);
                        }
                        GeneratedField::SupportDnsConfigPatch => {
                            if support_dns_config_patch__.is_some() {
                                return Err(serde::de::Error::duplicate_field("supportDnsConfigPatch"));
                            }
                            support_dns_config_patch__ = map_.next_value()?;
                        }
                    }
                }
                Ok(HeartbeatRequest {
                    machine_id: machine_id__,
                    inst_id: inst_id__,
                    user_token: user_token__.unwrap_or_default(),
                    easytier_version: easytier_version__.unwrap_or_default(),
                    report_time: report_time__.unwrap_or_default(),
                    hostname: hostname__.unwrap_or_default(),
                    running_network_instances: running_network_instances__.unwrap_or_default(),
                    device_os: device_os__,
                    support_config_source: support_config_source__.unwrap_or_default(),
                    failed_network_instances: failed_network_instances__.unwrap_or_default(),
                    support_heartbeat_policy: support_heartbeat_policy__.unwrap_or_default(),
                    support_manual_routes_patch: support_manual_routes_patch__.unwrap_or_default(),
                    support_dns_config_patch: support_dns_config_patch__,
                })
            }
        }
        deserializer.deserialize_struct("web.HeartbeatRequest", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for HeartbeatResponse {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.heartbeat_interval_ms.is_some() {
            len += 1;
        }
        if self.heartbeat_timeout_ms.is_some() {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("web.HeartbeatResponse", len)?;
        if let Some(v) = self.heartbeat_interval_ms.as_ref() {
            struct_ser.serialize_field("heartbeat_interval_ms", v)?;
        }
        if let Some(v) = self.heartbeat_timeout_ms.as_ref() {
            struct_ser.serialize_field("heartbeat_timeout_ms", v)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for HeartbeatResponse {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "heartbeat_interval_ms",
            "heartbeatIntervalMs",
            "heartbeat_timeout_ms",
            "heartbeatTimeoutMs",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            HeartbeatIntervalMs,
            HeartbeatTimeoutMs,
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
                            "heartbeatIntervalMs" | "heartbeat_interval_ms" => Ok(GeneratedField::HeartbeatIntervalMs),
                            "heartbeatTimeoutMs" | "heartbeat_timeout_ms" => Ok(GeneratedField::HeartbeatTimeoutMs),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = HeartbeatResponse;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct web.HeartbeatResponse")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<HeartbeatResponse, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut heartbeat_interval_ms__ = None;
                let mut heartbeat_timeout_ms__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::HeartbeatIntervalMs => {
                            if heartbeat_interval_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("heartbeatIntervalMs"));
                            }
                            heartbeat_interval_ms__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                        GeneratedField::HeartbeatTimeoutMs => {
                            if heartbeat_timeout_ms__.is_some() {
                                return Err(serde::de::Error::duplicate_field("heartbeatTimeoutMs"));
                            }
                            heartbeat_timeout_ms__ = 
                                map_.next_value::<::std::option::Option<::pbjson::private::NumberDeserialize<_>>>()?.map(|x| x.0)
                            ;
                        }
                    }
                }
                Ok(HeartbeatResponse {
                    heartbeat_interval_ms: heartbeat_interval_ms__,
                    heartbeat_timeout_ms: heartbeat_timeout_ms__,
                })
            }
        }
        deserializer.deserialize_struct("web.HeartbeatResponse", FIELDS, GeneratedVisitor)
    }
}
