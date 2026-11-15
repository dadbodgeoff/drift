from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from blog.views import CommentViewSet, PostViewSet, ReportViewSet

router = DefaultRouter()
router.register(r"posts", PostViewSet, basename="post")
router.register(r"comments", CommentViewSet)
router.register(r"reports", ReportViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("blog/", include("blog.urls")),
    path("api/", include(router.urls)),
]
