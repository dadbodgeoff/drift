from django.contrib.auth.decorators import login_required
from django.urls import include, path, re_path

from . import views

app_name = "blog"

draft_patterns = [
    path("", login_required(views.drafts), name="drafts"),
]

urlpatterns = [
    path("", views.index, name="index"),
    path("<int:pk>/", views.PostDetail.as_view(), name="detail"),
    path("health/", views.health),
    path("signup/", views.signup),
    path("login/", views.SignInView.as_view()),
    path("tokens/provision/", views.TokenProvisionView.as_view()),
    path("whoami/", views.WhoAmIView.as_view()),
    re_path(r"^archive/(?P<year>[0-9]{4})/$", views.archive),
]
urlpatterns += [path("drafts/", include(draft_patterns))]
