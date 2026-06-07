// Polling loop — runs on a timer, fetches Canvas data, surfaces urgent items via TaskFlow.
import type { PluginLogger, PluginRuntime } from "../api.js";
import { CanvasClient } from "./client.js";
import { classifyAnnouncement, classifyAssignment, formatBriefing } from "./prioritize.js";
import type { CanvasPluginConfig, SurfacedItem } from "./types.js";

export class CanvasPoller {
  private readonly client: CanvasClient;
  private readonly config: CanvasPluginConfig;
  private readonly runtime: PluginRuntime;
  private readonly logger: PluginLogger;

  // Track seen item IDs so we don't re-surface the same items across polls.
  private readonly seenAssignments = new Set<number>();
  private readonly seenAnnouncements = new Set<number>();

  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: CanvasPluginConfig, runtime: PluginRuntime, logger: PluginLogger) {
    this.config = config;
    this.runtime = runtime;
    this.logger = logger;
    this.client = new CanvasClient(config.apiUrl, config.apiToken);
  }

  start(): void {
    // Run immediately on startup, then on the configured interval.
    void this.poll();
    this.intervalId = setInterval(
      () => void this.poll(),
      this.config.pollIntervalMinutes * 60 * 1000,
    );
    this.logger.info?.(
      `[canvas-lms] polling every ${this.config.pollIntervalMinutes}m for session ${this.config.sessionKey}`,
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const courses = await this.client.getCourses();
      const allItems: SurfacedItem[] = [];

      for (const course of courses) {
        // Assignments
        const assignments = await this.client.getUpcomingAssignments(course.id);
        for (const a of assignments) {
          if (this.seenAssignments.has(a.id)) continue;
          const item = classifyAssignment(a, course, this.config.deadlineWarningHours);
          if (item) {
            allItems.push(item);
            // Mark Q1 as seen so we don't re-alert on the same item every poll.
            // Q2 items get re-evaluated next poll in case urgency has escalated.
            if (item.quadrant === "Q1") this.seenAssignments.add(a.id);
          }
        }

        // Announcements
        const announcements = await this.client.getAnnouncements(course.id);
        for (const ann of announcements) {
          if (this.seenAnnouncements.has(ann.id)) continue;
          const item = classifyAnnouncement(ann, course);
          allItems.push(item);
          this.seenAnnouncements.add(ann.id);
        }
      }

      if (allItems.length === 0) return;

      // Q1 items get surfaced immediately. Q2 items are batched into a briefing.
      const q1 = allItems.filter((i) => i.quadrant === "Q1");
      const q2 = allItems.filter((i) => i.quadrant === "Q2");

      if (q1.length > 0) {
        const briefing = formatBriefing(q1);
        await this.deliver(briefing, "canvas-lms/urgent");
      }

      if (q2.length > 0) {
        const briefing = formatBriefing(q2);
        await this.deliver(briefing, "canvas-lms/upcoming");
      }
    } catch (err) {
      this.logger.error?.(`[canvas-lms] poll error: ${String(err)}`);
    }
  }

  private async deliver(message: string, controllerId: string): Promise<void> {
    try {
      const taskFlow = this.runtime.tasks.managedFlows.bindSession({
        sessionKey: this.config.sessionKey,
      });

      const flow = taskFlow.createManaged({
        controllerId,
        goal: message,
        currentStep: "notify",
        stateJson: { message, deliveredAt: new Date().toISOString() },
      });

      taskFlow.finish({
        flowId: flow.flowId,
        expectedRevision: flow.revision,
        stateJson: flow.stateJson,
      });

      this.logger.info?.(`[canvas-lms] delivered ${controllerId} to ${this.config.sessionKey}`);
    } catch (err) {
      this.logger.error?.(`[canvas-lms] delivery error: ${String(err)}`);
    }
  }
}
