//! Framework lineage of Python classes (round 8, W1): what kind of class a class is by
//! what it is built on, resolved through the repo's own bases to a framework base.
//!
//! A role of "classes in `api.py` files" mixes serializers, permission classes, fields
//! and helpers, so "most of them do X" is not a convention about any one kind. The
//! lineage kind ([`KINDS`]) is recorded as a trait (`lineage_<kind>`, from the Python
//! repo pass) and becomes part of the role key (`RoleSelector::member_kind`), so each
//! kind is mined on its own. A class whose lineage does not resolve to one of these
//! bases is a plain class: no kind is guessed from its name or its file.

/// Lineage kinds, by name as roles and traits spell them.
pub const VIEW: &str = "view";
pub const SERIALIZER: &str = "serializer";
pub const MODEL: &str = "model";
pub const FORM: &str = "form";
pub const ADMIN: &str = "admin";
pub const INLINE: &str = "inline";
pub const MIXIN: &str = "mixin";
pub const EXCEPTION: &str = "exception";

/// Every lineage kind.
pub const KINDS: &[&str] = &[
    VIEW, SERIALIZER, MODEL, FORM, ADMIN, INLINE, MIXIN, EXCEPTION,
];

/// Prefix of the trait that records a class's lineage kind (`lineage_serializer`).
pub const TRAIT_PREFIX: &str = "lineage_";

/// The trait for lineage kind `kind`.
pub fn trait_for(kind: &str) -> String {
    format!("{TRAIT_PREFIX}{kind}")
}

/// The lineage kind a symbol's traits record, if any.
pub fn of_traits(traits: &[String]) -> Option<&'static str> {
    traits.iter().find_map(|t| {
        let k = t.strip_prefix(TRAIT_PREFIX)?;
        KINDS.iter().find(|x| **x == k).copied()
    })
}

/// Django REST framework serializers (not fields, not the metaclass).
const SERIALIZERS: &[&str] = &[
    "pkg:rest_framework#serializers.Serializer",
    "pkg:rest_framework#serializers.ModelSerializer",
    "pkg:rest_framework#serializers.HyperlinkedModelSerializer",
    "pkg:rest_framework#serializers.ListSerializer",
    "pkg:rest_framework#serializers.BaseSerializer",
    "pkg:rest_framework#serializers.serializers.Serializer",
    "pkg:rest_framework_gis#serializers.GeoFeatureModelSerializer",
    "pkg:taggit#serializers.TaggitSerializer",
];

/// Django ORM models and the model bases of well-known Django packages. Not
/// SQLModel (a schema unless declared a table) nor pydantic.
const MODELS: &[&str] = &[
    "pkg:django#db.models.Model",
    "pkg:django#db.models.base.Model",
    "pkg:django#contrib.auth.models.AbstractUser",
    "pkg:django#contrib.auth.models.AbstractBaseUser",
    "pkg:django#contrib.auth.models.User",
    "pkg:django#contrib.auth.base_user.AbstractBaseUser",
    "pkg:mptt#models.MPTTModel",
    "pkg:polymorphic#models.PolymorphicModel",
    "pkg:django_softdelete#models.SoftDeleteModel",
    "pkg:treenode#models.TreeNodeModel",
    "pkg:taggit#models.TagBase",
    "pkg:taggit#models.TaggedItemBase",
    "pkg:taggit#models.GenericTaggedItemBase",
    "pkg:model_utils#models.TimeStampedModel",
    "pkg:rest_framework_api_key#models.AbstractAPIKey",
];

/// Django and WTForms forms (not form fields, widgets or formsets).
const FORMS: &[&str] = &[
    "pkg:django#forms.Form",
    "pkg:django#forms.ModelForm",
    "pkg:django#forms.BaseForm",
    "pkg:django#forms.BaseModelForm",
    "pkg:django#forms.forms.Form",
    "pkg:django#forms.forms.BaseForm",
    "pkg:django#forms.models.ModelForm",
    "pkg:django#forms.models.BaseModelForm",
    "pkg:django#contrib.auth.forms.AuthenticationForm",
    "pkg:django#contrib.auth.forms.UserCreationForm",
    "pkg:django#contrib.auth.forms.BaseUserCreationForm",
    "pkg:django#contrib.auth.forms.UserChangeForm",
    "pkg:django#contrib.auth.forms.PasswordChangeForm",
    "pkg:django#contrib.auth.forms.SetPasswordForm",
    "pkg:django#contrib.auth.forms.PasswordResetForm",
    "pkg:django#contrib.auth.forms.AdminPasswordChangeForm",
    "pkg:allauth#account.forms.SignupForm",
    "pkg:allauth#account.forms.LoginForm",
    "pkg:flask_wtf#FlaskForm",
    "pkg:flask_wtf#Form",
    "pkg:wtforms#Form",
    "pkg:wtforms#form.Form",
];

/// Django admin inlines: edited inside a model admin, never registered themselves, so
/// a kind apart from the model admins.
const INLINES: &[&str] = &[
    "pkg:django#contrib.admin.TabularInline",
    "pkg:django#contrib.admin.StackedInline",
    "pkg:django#contrib.admin.options.TabularInline",
    "pkg:django#contrib.admin.options.StackedInline",
    "pkg:django#contrib.admin.options.InlineModelAdmin",
    "pkg:django#contrib.contenttypes.admin.GenericTabularInline",
    "pkg:django#contrib.contenttypes.admin.GenericStackedInline",
];

/// Django model admins.
const ADMINS: &[&str] = &[
    "pkg:django#contrib.admin.ModelAdmin",
    "pkg:django#contrib.admin.options.ModelAdmin",
    "pkg:django#contrib.auth.admin.UserAdmin",
    "pkg:django#contrib.auth.admin.GroupAdmin",
    "pkg:guardian#admin.GuardedModelAdmin",
    "pkg:mptt#admin.MPTTModelAdmin",
    "pkg:mptt#admin.DraggableMPTTAdmin",
    "pkg:import_export#admin.ImportExportModelAdmin",
    "pkg:simple_history#admin.SimpleHistoryAdmin",
    "pkg:reversion#admin.VersionAdmin",
    "pkg:treenode#admin.TreeNodeModelAdmin",
    "pkg:auditlog#admin.LogEntryAdmin",
    "pkg:rest_framework_api_key#admin.APIKeyModelAdmin",
];

/// Python's built-in exception classes (`global#<name>`).
const BUILTIN_EXCEPTIONS: &[&str] = &[
    "BaseException",
    "Exception",
    "ArithmeticError",
    "AssertionError",
    "AttributeError",
    "BlockingIOError",
    "BrokenPipeError",
    "BufferError",
    "ConnectionError",
    "ConnectionAbortedError",
    "ConnectionRefusedError",
    "ConnectionResetError",
    "EOFError",
    "EnvironmentError",
    "FileExistsError",
    "FileNotFoundError",
    "FloatingPointError",
    "IOError",
    "ImportError",
    "IndexError",
    "InterruptedError",
    "IsADirectoryError",
    "KeyError",
    "LookupError",
    "MemoryError",
    "ModuleNotFoundError",
    "NameError",
    "NotADirectoryError",
    "NotImplementedError",
    "OSError",
    "OverflowError",
    "PermissionError",
    "ProcessLookupError",
    "RecursionError",
    "ReferenceError",
    "RuntimeError",
    "StopIteration",
    "StopAsyncIteration",
    "SyntaxError",
    "SystemError",
    "TimeoutError",
    "TypeError",
    "UnboundLocalError",
    "UnicodeError",
    "UnicodeDecodeError",
    "UnicodeEncodeError",
    "ValueError",
    "ZeroDivisionError",
    "Warning",
    "UserWarning",
    "DeprecationWarning",
    "PendingDeprecationWarning",
    "RuntimeWarning",
    "FutureWarning",
    "ExceptionGroup",
    "BaseExceptionGroup",
];

/// Package exception classes named outside an `exceptions`/`errors` module.
const PACKAGE_EXCEPTIONS: &[&str] = &[
    "pkg:fastapi#HTTPException",
    "pkg:graphql#GraphQLError",
    "pkg:httpx#HTTPStatusError",
    "pkg:httpx#HTTPError",
    "pkg:click#ClickException",
    "pkg:click#UsageError",
    "pkg:click#BadParameter",
];

/// The last dotted segment of a canonical id's name (`serializers.ModelSerializer` ->
/// `ModelSerializer`).
fn last_segment(base: &str) -> &str {
    let name = base.split_once('#').map_or(base, |(_, n)| n);
    name.rsplit('.').next().unwrap_or(name)
}

/// A mixin by name: the class (or base) is named `*Mixin`.
pub fn mixin_name(name: &str) -> bool {
    name.len() > 5 && name.ends_with("Mixin")
}

/// Framework base classes of class-based views (canonical ids). Mixins added to views
/// (`ContextMixin`, `LoginRequiredMixin`) are no view themselves.
pub fn framework_view(base: &str) -> bool {
    if base.ends_with("Mixin") {
        return false;
    }
    if let Some(rest) = base.strip_prefix("pkg:django#") {
        return rest.starts_with("views.") || rest.starts_with("contrib.auth.views.");
    }
    if let Some(rest) = base.strip_prefix("pkg:rest_framework#") {
        let last = rest.rsplit('.').next().unwrap_or(rest);
        return last.ends_with("View") || last.ends_with("ViewSet");
    }
    matches!(
        base,
        "pkg:flask#views.MethodView"
            | "pkg:flask#views.View"
            | "pkg:flask_restx#Resource"
            | "pkg:flask_restx#resource.Resource"
            | "pkg:flask_restplus#Resource"
            | "pkg:flask_restplus#resource.Resource"
            | "pkg:flask_restful#Resource"
    )
}

/// The lineage kind a framework or built-in base (a canonical id that is not a class of
/// the repo) gives the classes built on it, if it is one Drift knows. `None` for every
/// other base: an unresolved name, a package class of no known kind, `object`.
pub fn framework_kind(base: &str) -> Option<&'static str> {
    if base.starts_with("unresolved:") {
        return None;
    }
    if mixin_name(last_segment(base)) {
        return Some(MIXIN);
    }
    if framework_view(base) {
        return Some(VIEW);
    }
    let listed = |table: &[&str]| table.contains(&base);
    if listed(SERIALIZERS) {
        return Some(SERIALIZER);
    }
    if listed(MODELS) {
        return Some(MODEL);
    }
    if listed(FORMS) {
        return Some(FORM);
    }
    if listed(ADMINS) {
        return Some(ADMIN);
    }
    if listed(INLINES) {
        return Some(INLINE);
    }
    if let Some(name) = base.strip_prefix("global#") {
        return BUILTIN_EXCEPTIONS.contains(&name).then_some(EXCEPTION);
    }
    if listed(PACKAGE_EXCEPTIONS) {
        return Some(EXCEPTION);
    }
    // A class of a package's `exceptions` or `errors` module (`rest_framework.exceptions.
    // APIException`, `django.core.exceptions.ValidationError`) named as an exception.
    if let Some((_, name)) = base.split_once('#')
        && base.starts_with("pkg:")
    {
        let segs: Vec<&str> = name.split('.').collect();
        let last = segs.last().copied().unwrap_or_default();
        let module = segs[..segs.len().saturating_sub(1)]
            .iter()
            .any(|s| matches!(*s, "exceptions" | "errors"));
        if module && (last.ends_with("Error") || last.ends_with("Exception") || last == "Http404") {
            return Some(EXCEPTION);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framework_kinds() {
        for (base, want) in [
            (
                "pkg:rest_framework#serializers.ModelSerializer",
                Some(SERIALIZER),
            ),
            ("pkg:rest_framework#serializers.CharField", None),
            ("pkg:rest_framework#serializers.SerializerMetaclass", None),
            ("pkg:rest_framework#viewsets.ModelViewSet", Some(VIEW)),
            ("pkg:rest_framework#mixins.ListModelMixin", Some(MIXIN)),
            ("pkg:rest_framework#permissions.BasePermission", None),
            ("pkg:django#db.models.Model", Some(MODEL)),
            ("pkg:django#db.models.Manager", None),
            ("pkg:django#forms.ModelForm", Some(FORM)),
            ("pkg:django#forms.CharField", None),
            ("pkg:flask_wtf#FlaskForm", Some(FORM)),
            ("pkg:django#contrib.admin.TabularInline", Some(INLINE)),
            ("pkg:django#contrib.admin.ModelAdmin", Some(ADMIN)),
            ("pkg:django#contrib.admin.SimpleListFilter", None),
            (
                "pkg:django#contrib.auth.mixins.LoginRequiredMixin",
                Some(MIXIN),
            ),
            ("pkg:django#views.generic.ListView", Some(VIEW)),
            ("global#Exception", Some(EXCEPTION)),
            ("global#ValueError", Some(EXCEPTION)),
            ("global#str", None),
            ("global#object", None),
            ("global#MyError", None),
            (
                "pkg:rest_framework#exceptions.APIException",
                Some(EXCEPTION),
            ),
            (
                "pkg:django#core.exceptions.ValidationError",
                Some(EXCEPTION),
            ),
            ("pkg:anthropic#BadRequestError", None),
            ("pkg:pydantic#BaseModel", None),
            ("unresolved:Foo", None),
        ] {
            assert_eq!(framework_kind(base), want, "{base}");
        }
    }

    #[test]
    fn every_kind_has_its_trait_constant() {
        use crate::traits::*;
        let consts = [
            LINEAGE_VIEW,
            LINEAGE_SERIALIZER,
            LINEAGE_MODEL,
            LINEAGE_FORM,
            LINEAGE_ADMIN,
            LINEAGE_INLINE,
            LINEAGE_MIXIN,
            LINEAGE_EXCEPTION,
        ];
        let want: Vec<String> = KINDS.iter().map(|k| trait_for(k)).collect();
        assert_eq!(consts.to_vec(), want);
    }

    #[test]
    fn traits_round_trip() {
        assert_eq!(of_traits(&[trait_for(SERIALIZER)]), Some(SERIALIZER));
        assert_eq!(of_traits(&["base".into(), "lineage_nope".into()]), None);
    }
}
