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
from tasks.api import (TaskViewSet, TagViewSet, TimeBucketViewSet, SettingsView,
                       TimeBucketTypeViewSet, RecurrencePreviewView, MarkerViewSet, CalendarViewSet, TimeSheetView,
                       DependencyViewSet, PlannerView, PlanAlternativesView, PlanViewSet)
from plina.django_views import forbidden_error_view, not_found_error_view, internal_error_view
from accounts import urls as accounts_urls

router = routers.DefaultRouter()
router.register(r'tasks', TaskViewSet)
router.register(r'tags', TagViewSet)
router.register(r'timebuckets', TimeBucketViewSet)
router.register(r'buckettypes', TimeBucketTypeViewSet)
router.register(r'dependencies', DependencyViewSet)
router.register(r'plans', PlanViewSet)
router.register(r'markers', MarkerViewSet, basename='marker')
router.register(r'calendars', CalendarViewSet, basename='calendar')

urlpatterns = [
    # Logging in (README: Accounts); everything else needs a login.
    path('api/auth/', include(accounts_urls.api_urls)),
    path('django/oidc/', include(accounts_urls.oidc_urls)),
    path('api/', include(router.urls)),
    path('api/plan/alternatives/', PlanAlternativesView.as_view(), name='plan-alternatives'),
    path('api/recurrence-preview/', RecurrencePreviewView.as_view(), name='recurrence-preview'),
    path('api/settings/', SettingsView.as_view(), name='settings'),
    path('api/timesheet/', TimeSheetView.as_view(), name='timesheet'),
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


