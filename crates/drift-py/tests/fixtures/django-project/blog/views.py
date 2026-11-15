from django.contrib.auth.decorators import login_not_required, login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.auth.views import LoginView
from django.shortcuts import redirect, render
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods
from django.views.generic import DetailView
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.views import APIView
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated

from .models import Post
from .serializers import PostSerializer


@login_required
def index(request):
    return render(request, "blog/index.html", {"posts": Post.objects.all()})


@require_http_methods(["GET", "POST"])
def drafts(request):
    return render(request, "blog/drafts.html")


def archive(request, year):
    return redirect(request.GET.get("next"))


@method_decorator(never_cache, name="dispatch")
class PostDetail(LoginRequiredMixin, DetailView):
    model = Post

    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class PostViewSet(viewsets.ModelViewSet):
    queryset = Post.objects.all()
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return super().list(request)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        return None


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return None


@login_not_required
def signup(request):
    return render(request, "blog/signup.html")


class SignInView(LoginView):
    template_name = "blog/login.html"


class CommentViewSet(viewsets.ModelViewSet):
    queryset = Post.objects.all()


class StaffViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    authentication_classes = [SessionAuthentication]


class ReportViewSet(StaffViewSet):
    def list(self, request):
        return super().list(request)


class TokenProvisionView(APIView):
    """Open: no permission classes, so the default authentication rejects nothing."""

    permission_classes = []

    def post(self, request):
        return None


class WhoAmIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        return None
