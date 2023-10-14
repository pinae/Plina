from lona.view import LonaView
from lona.html import HTML, H1, Ul, Li
from tasks.models import Project


class ProjectsView(LonaView):
    def handle_request(self, request):
        project_lis = [Li(str(t)) for t in Project.objects.all()]
        return HTML(
            H1('Projekte'),
            Ul(project_lis)
        )
