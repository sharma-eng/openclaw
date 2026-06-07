// Canvas LMS domain types used across the plugin.

export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  course_id: number;
  html_url: string;
  description: string | null;
  submission_types: string[];
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string;
  posted_at: string;
  course_id: number;
  html_url: string;
}

export interface CanvasGrade {
  course_id: number;
  current_score: number | null;
  final_score: number | null;
  current_grade: string | null;
}

export interface CanvasPluginConfig {
  apiUrl: string;
  apiToken: string;
  sessionKey: string;
  deadlineWarningHours: number;
  pollIntervalMinutes: number;
}

// Eisenhower urgency classification for surfaced items.
export type UrgencyQuadrant = "Q1" | "Q2" | "Q3" | "Q4";

export interface SurfacedItem {
  quadrant: UrgencyQuadrant;
  title: string;
  detail: string;
  url: string;
  dueAt: Date | null;
  source: "assignment" | "announcement" | "grade";
}
