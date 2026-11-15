import { Module } from "@nestjs/common";
import { RefundsController } from "./refunds/refunds.controller";
import { RefundsService } from "./refunds/refunds.service";
import { UsersController } from "./users/users.controller";
import { UsersService } from "./users/users.service";
import { TeamsController } from "./teams/teams.controller";
import { TeamsService } from "./teams/teams.service";
import { BillingController } from "./billing/billing.controller";
import { BillingService } from "./billing/billing.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { InvoicesController } from "./invoices/invoices.controller";
import { InvoicesService } from "./invoices/invoices.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportsService } from "./reports/reports.service";
import { FilesController } from "./files/files.controller";
import { FilesService } from "./files/files.service";
import { CommentsController } from "./comments/comments.controller";
import { CommentsService } from "./comments/comments.service";
import { LabelsController } from "./labels/labels.controller";
import { LabelsService } from "./labels/labels.service";
import { MilestonesController } from "./milestones/milestones.controller";
import { MilestonesService } from "./milestones/milestones.service";
import { ReleasesController } from "./releases/releases.controller";
import { ReleasesService } from "./releases/releases.service";
import { DeploymentsController } from "./deployments/deployments.controller";
import { DeploymentsService } from "./deployments/deployments.service";
import { SecretsController } from "./secrets/secrets.controller";
import { SecretsService } from "./secrets/secrets.service";
import { EnvironmentsController } from "./environments/environments.controller";
import { EnvironmentsService } from "./environments/environments.service";
import { AuditsController } from "./audits/audits.controller";
import { AuditsService } from "./audits/audits.service";
import { NotificationsController } from "./notifications/notifications.controller";
import { NotificationsService } from "./notifications/notifications.service";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { WebhooksService } from "./webhooks/webhooks.service";
import { TokensController } from "./tokens/tokens.controller";
import { TokensService } from "./tokens/tokens.service";
import { SessionsController } from "./sessions/sessions.controller";
import { SessionsService } from "./sessions/sessions.service";
import { RegionsController } from "./regions/regions.controller";
import { RegionsService } from "./regions/regions.service";
import { QuotasController } from "./quotas/quotas.controller";
import { QuotasService } from "./quotas/quotas.service";
import { AlertsController } from "./alerts/alerts.controller";
import { AlertsService } from "./alerts/alerts.service";
import { PipelinesController } from "./pipelines/pipelines.controller";
import { PipelinesService } from "./pipelines/pipelines.service";
import { ArtifactsController } from "./artifacts/artifacts.controller";
import { ArtifactsService } from "./artifacts/artifacts.service";

@Module({
  controllers: [
    RefundsController,
    UsersController,
    TeamsController,
    BillingController,
    ProjectsController,
    InvoicesController,
    ReportsController,
    FilesController,
    CommentsController,
    LabelsController,
    MilestonesController,
    ReleasesController,
    DeploymentsController,
    SecretsController,
    EnvironmentsController,
    AuditsController,
    NotificationsController,
    WebhooksController,
    TokensController,
    SessionsController,
    RegionsController,
    QuotasController,
    AlertsController,
    PipelinesController,
    ArtifactsController,
  ],
  providers: [
    RefundsService,
    UsersService,
    TeamsService,
    BillingService,
    ProjectsService,
    InvoicesService,
    ReportsService,
    FilesService,
    CommentsService,
    LabelsService,
    MilestonesService,
    ReleasesService,
    DeploymentsService,
    SecretsService,
    EnvironmentsService,
    AuditsService,
    NotificationsService,
    WebhooksService,
    TokensService,
    SessionsService,
    RegionsService,
    QuotasService,
    AlertsService,
    PipelinesService,
    ArtifactsService,
  ],
})
export class AppModule {}
