impl serde::Serialize for ApiSpelling {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if !self.field.is_empty() {
            len += 1;
        }
        if self.negate {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("easytier.ApiSpelling", len)?;
        if !self.field.is_empty() {
            struct_ser.serialize_field("field", &self.field)?;
        }
        if self.negate {
            struct_ser.serialize_field("negate", &self.negate)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for ApiSpelling {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "field",
            "negate",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Field,
            Negate,
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
                            "field" => Ok(GeneratedField::Field),
                            "negate" => Ok(GeneratedField::Negate),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = ApiSpelling;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct easytier.ApiSpelling")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<ApiSpelling, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut field__ = None;
                let mut negate__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Field => {
                            if field__.is_some() {
                                return Err(serde::de::Error::duplicate_field("field"));
                            }
                            field__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Negate => {
                            if negate__.is_some() {
                                return Err(serde::de::Error::duplicate_field("negate"));
                            }
                            negate__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(ApiSpelling {
                    field: field__.unwrap_or_default(),
                    negate: negate__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("easytier.ApiSpelling", FIELDS, GeneratedVisitor)
    }
}
impl serde::Serialize for FlagMeta {
    #[allow(deprecated)]
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut len = 0;
        if self.default.is_some() {
            len += 1;
        }
        if self.api.is_some() {
            len += 1;
        }
        if self.form {
            len += 1;
        }
        if self.deprecated {
            len += 1;
        }
        let mut struct_ser = serializer.serialize_struct("easytier.FlagMeta", len)?;
        if let Some(v) = self.default.as_ref() {
            struct_ser.serialize_field("default", v)?;
        }
        if let Some(v) = self.api.as_ref() {
            struct_ser.serialize_field("api", v)?;
        }
        if self.form {
            struct_ser.serialize_field("form", &self.form)?;
        }
        if self.deprecated {
            struct_ser.serialize_field("deprecated", &self.deprecated)?;
        }
        struct_ser.end()
    }
}
impl<'de> serde::Deserialize<'de> for FlagMeta {
    #[allow(deprecated)]
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        const FIELDS: &[&str] = &[
            "default",
            "api",
            "form",
            "deprecated",
        ];

        #[allow(clippy::enum_variant_names)]
        enum GeneratedField {
            Default,
            Api,
            Form,
            Deprecated,
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
                            "default" => Ok(GeneratedField::Default),
                            "api" => Ok(GeneratedField::Api),
                            "form" => Ok(GeneratedField::Form),
                            "deprecated" => Ok(GeneratedField::Deprecated),
                            _ => Err(serde::de::Error::unknown_field(value, FIELDS)),
                        }
                    }
                }
                deserializer.deserialize_identifier(GeneratedVisitor)
            }
        }
        struct GeneratedVisitor;
        impl<'de> serde::de::Visitor<'de> for GeneratedVisitor {
            type Value = FlagMeta;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("struct easytier.FlagMeta")
            }

            fn visit_map<V>(self, mut map_: V) -> std::result::Result<FlagMeta, V::Error>
                where
                    V: serde::de::MapAccess<'de>,
            {
                let mut default__ = None;
                let mut api__ = None;
                let mut form__ = None;
                let mut deprecated__ = None;
                while let Some(k) = map_.next_key()? {
                    match k {
                        GeneratedField::Default => {
                            if default__.is_some() {
                                return Err(serde::de::Error::duplicate_field("default"));
                            }
                            default__ = map_.next_value()?;
                        }
                        GeneratedField::Api => {
                            if api__.is_some() {
                                return Err(serde::de::Error::duplicate_field("api"));
                            }
                            api__ = map_.next_value()?;
                        }
                        GeneratedField::Form => {
                            if form__.is_some() {
                                return Err(serde::de::Error::duplicate_field("form"));
                            }
                            form__ = Some(map_.next_value()?);
                        }
                        GeneratedField::Deprecated => {
                            if deprecated__.is_some() {
                                return Err(serde::de::Error::duplicate_field("deprecated"));
                            }
                            deprecated__ = Some(map_.next_value()?);
                        }
                    }
                }
                Ok(FlagMeta {
                    default: default__,
                    api: api__,
                    form: form__.unwrap_or_default(),
                    deprecated: deprecated__.unwrap_or_default(),
                })
            }
        }
        deserializer.deserialize_struct("easytier.FlagMeta", FIELDS, GeneratedVisitor)
    }
}
