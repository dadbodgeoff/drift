from django.urls import path

from api.main import api

urlpatterns = [path("api/", api.urls)]
