from django.urls import path

from . import views

urlpatterns = [
    path("", views.BackupListCreateView.as_view(), name="backup-list"),
    path("<str:filename>/download/", views.BackupDownloadView.as_view(), name="backup-download"),
]
