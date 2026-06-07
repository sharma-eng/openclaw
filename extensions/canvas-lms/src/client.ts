// Canvas REST API client — thin fetch wrapper, no magic.
import type { CanvasAnnouncement, CanvasAssignment, CanvasCourse, CanvasGrade } from "./types.js";

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(apiUrl: string, apiToken: string) {
    // Normalize: strip trailing slash, ensure /api/v1 suffix.
    const base = apiUrl.replace(/\/$/, "");
    this.baseUrl = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
    this.headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), { headers: this.headers });
    if (!res.ok) {
      throw new Error(`[canvas-lms] GET ${path} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  /** Returns active courses the user is enrolled in. */
  async getCourses(): Promise<CanvasCourse[]> {
    return this.get<CanvasCourse[]>("/courses", {
      enrollment_state: "active",
      per_page: "50",
    });
  }

  /** Returns upcoming assignments for a course that have not yet been submitted. */
  async getUpcomingAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.get<CanvasAssignment[]>(`/courses/${courseId}/assignments`, {
      order_by: "due_at",
      bucket: "upcoming",
      per_page: "50",
    });
  }

  /** Returns recent announcements for a course (last 7 days). */
  async getAnnouncements(courseId: number): Promise<CanvasAnnouncement[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.get<CanvasAnnouncement[]>("/announcements", {
      "context_codes[]": `course_${courseId}`,
      start_date: sevenDaysAgo,
      per_page: "20",
    });
  }

  /** Returns current enrollment grades for a course. */
  async getGrades(courseId: number): Promise<CanvasGrade | null> {
    try {
      const enrollments = await this.get<
        Array<{
          grades: {
            current_score: number | null;
            final_score: number | null;
            current_grade: string | null;
          };
        }>
      >(`/courses/${courseId}/enrollments`, {
        type: "StudentEnrollment",
        per_page: "1",
      });
      const grade = enrollments[0]?.grades;
      if (!grade) return null;
      return {
        course_id: courseId,
        current_score: grade.current_score,
        final_score: grade.final_score,
        current_grade: grade.current_grade,
      };
    } catch {
      // Grades may not be visible; treat as non-fatal.
      return null;
    }
  }
}
