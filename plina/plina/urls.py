"""
URL configuration for plina project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from rest_framework import routers
from tasks.api import TaskViewSet, ProjectViewSet, TagViewSet, TimeBucketViewSet, PlannerView
from plina.django_views import forbidden_error_view, not_found_error_view, internal_error_view

router = routers.DefaultRouter()
router.register(r'tasks', TaskViewSet)
router.register(r'projects', ProjectViewSet)
router.register(r'tags', TagViewSet)
router.register(r'timebuckets', TimeBucketViewSet)

urlpatterns = [
    path('api/', include(router.urls)),
    path('api/plan/', PlannerView.as_view()),
    
    # admin
    path('django/admin/', admin.site.urls),

    # accounts
    path('django/accounts/', include('django.contrib.auth.urls')),

    # error pages
    path(
        'django/forbidden-error/',
        forbidden_error_view,
        name='forbidden-error',
    ),

    path(
        'django/not-found-error/',
        not_found_error_view,
        name='not-found-error',
    ),

    path(
        'django/internal-error/',
        internal_error_view,
        name='internal-error',
    ),
]


