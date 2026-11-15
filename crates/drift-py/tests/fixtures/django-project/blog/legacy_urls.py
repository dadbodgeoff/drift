from django.urls import path

from . import views

# Not included by mysite.urls (ROOT_URLCONF): Django never serves these.
urlpatterns = [
    path("old-index/", views.index),
]
