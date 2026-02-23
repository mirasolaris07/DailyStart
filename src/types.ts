export interface Task {
  id: number;
  title: string;
  description: string;
  priority: number;
  status: 'pending' | 'completed';
  due_at?: string;
  in_working_area: boolean;
  is_hidden: boolean;
  account_email?: string;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  isTask?: boolean;
  taskId?: number;
  priority?: number;
  accountEmail?: string;
  calendarName?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
}

export interface Connection {
  email: string;
  updated_at: string;
}

export interface BriefingData {
  summary: string;
  encouragement: string;
  tasksWithSteps: {
    taskId: number | null;
    title: string;
    priority: number;
    isSuggested: boolean;
    steps: string[];
  }[];
  imageUrl?: string;
}
