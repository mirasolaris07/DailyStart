import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Plus,
  Trash2,
  LogOut,
  Coffee,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  EyeOff,
  HandMetal,
  Play,
  Pause,
  RotateCcw,
  Timer,
  Clock,
  LayoutDashboard,
  ListTodo,
  CalendarDays,
  Grid,
  RefreshCw,
  X,
  MapPin,
  Mail,
  AlignLeft,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  isToday,
  setHours,
  setMinutes
} from 'date-fns';
import Markdown from 'react-markdown';
import { Task, CalendarEvent, BriefingData, Connection } from './types';
import { generateMorningBriefing } from './services/geminiService';

type ViewMode = 'day' | 'week' | 'month';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'briefing' | 'schedule' | 'tasks' | 'pomodoro'>('briefing');
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [isLoadingBriefing, setIsLoadingBriefing] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedWorkingTaskIds, setSelectedWorkingTaskIds] = useState<number[]>([]);
  const [pomodoroTime, setPomodoroTime] = useState(25 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isShowingConnections, setIsShowingConnections] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 2, due_at: format(new Date(), "yyyy-MM-dd'T'HH:mm") });
  const [pomodoroCycle, setPomodoroCycle] = useState(0);
  const pomodoroSessions = [
    { type: 'work', duration: 25 * 60, label: 'Work 1' },
    { type: 'rest', duration: 5 * 60, label: 'Break' },
    { type: 'work', duration: 25 * 60, label: 'Work 2' },
    { type: 'rest', duration: 5 * 60, label: 'Break' },
    { type: 'work', duration: 25 * 60, label: 'Work 3' },
    { type: 'rest', duration: 5 * 60, label: 'Break' },
    { type: 'work', duration: 25 * 60, label: 'Work 4' },
    { type: 'rest', duration: 20 * 60, label: 'Long Break' },
  ];
  const [taskAssignments, setTaskAssignments] = useState<Record<number, number[]>>({});
  const [notifications, setNotifications] = useState<{ id: string; title: string; message: string; type: 'info' | 'success' | 'warning'; persistent?: boolean }[]>([]);

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 beep
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio beep failed", e);
    }
  };

  const addNotification = (title: string, message: string, type: 'info' | 'success' | 'warning' = 'info', persistent = false) => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, title, message, type, persistent }]);
    if (!persistent) {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 5000);
    }
  };

  useEffect(() => {
    checkAuthStatus();
    fetchTasks();
  }, []);

  const fetchEvents = useCallback(async (date: Date, mode: ViewMode) => {
    let start, end;
    if (mode === 'day') {
      start = startOfDay(date);
      end = endOfDay(date);
    } else if (mode === 'week') {
      start = startOfWeek(date, { weekStartsOn: 1 });
      end = endOfWeek(date, { weekStartsOn: 1 });
    } else {
      start = startOfMonth(date);
      end = endOfMonth(date);
    }

    const res = await fetch(`/api/calendar/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}`);
    if (res.ok) {
      const data = await res.json();
      setEvents(data);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchEvents(currentDate, viewMode);
    }
  }, [isAuthenticated, currentDate, viewMode, fetchEvents]);

  // Automatically distribute working area tasks into the 4 work sessions (0, 2, 4, 6)
  useEffect(() => {
    const workingTasks = tasks
      .filter(t => t.in_working_area)
      .sort((a, b) => (a.priority || 2) - (b.priority || 2) || (new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()));

    if (workingTasks.length === 0) {
      setTaskAssignments({});
      return;
    }

    const newAssignments: Record<number, number[]> = {};
    const workSessions = [0, 2, 4, 6];

    // Initialize all sessions
    workSessions.forEach(idx => newAssignments[idx] = []);

    // First pass: distribute all tasks
    workingTasks.forEach((task, idx) => {
      const sessionIndex = workSessions[idx % workSessions.length];
      newAssignments[sessionIndex].push(task.id);
    });

    // Second pass: fill empty sessions by repeating tasks
    workSessions.forEach((sessionIndex, i) => {
      if (newAssignments[sessionIndex].length === 0) {
        newAssignments[sessionIndex].push(workingTasks[i % workingTasks.length].id);
      }
    });

    setTaskAssignments(newAssignments);
  }, [tasks.filter(t => t.in_working_area).length, tasks]);

  const fetchConnections = async () => {
    try {
      const res = await fetch('/api/auth/connections');
      if (res.ok) {
        const data = await res.json();
        console.log('Fetched connections:', data);
        setConnections(data);
      } else {
        console.error('Failed to fetch connections:', res.statusText);
      }
    } catch (e) {
      console.error('Error fetching connections:', e);
    }
  };

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
      if (data.isAuthenticated) {
        fetchConnections();
      }
    } catch (e) {
      setIsAuthenticated(false);
    }
  };

  const fetchTasks = async () => {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    setTasks(data);
  };

  // Nightly commitment prompt
  useEffect(() => {
    const checkNightly = () => {
      const now = new Date();
      if (now.getHours() === 21 && now.getMinutes() === 0) { // 9:00 PM
        addNotification(
          "Nightly Commitment",
          "It's 9:00 PM. What is your primary commitment for tomorrow? Type it in your tasks!",
          'info',
          true
        );
      }
    };
    const interval = setInterval(checkNightly, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    const res = await fetch('/api/auth/google/url');
    const { url } = await res.json();
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    window.open(url, 'google_auth', `width=${width},height=${height},left=${left},top=${top}`);
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsAuthenticated(true);
        fetchConnections();
        fetchEvents(currentDate, viewMode);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentDate, viewMode, fetchEvents]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setIsAuthenticated(false);
    setConnections([]);
    setEvents([]);
    setBriefing(null);
    setIsShowingConnections(false);
  };

  const removeConnection = async (email: string) => {
    const res = await fetch(`/api/auth/connections/${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (res.ok) {
      fetchConnections();
      fetchEvents(currentDate, viewMode);

      // If no connections left, log out
      const updatedConnections = connections.filter(c => c.email !== email);
      if (updatedConnections.length === 0) {
        setIsAuthenticated(false);
        setIsShowingConnections(false);
      }
    }
  };

  useEffect(() => {
    if (isShowingConnections) {
      fetchConnections();
    }
  }, [isShowingConnections]);

  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning && pomodoroTime > 0) {
      interval = setInterval(() => {
        setPomodoroTime((prev) => prev - 1);
      }, 1000);
    } else if (pomodoroTime === 0) {
      handlePomodoroComplete();
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, pomodoroTime]);

  const handlePomodoroComplete = async () => {
    setIsTimerRunning(false);
    const session = pomodoroSessions[pomodoroCycle];

    if (session.type === 'work') {
      const assignedTasks = taskAssignments[pomodoroCycle] || [];
      await Promise.all(assignedTasks.map(taskId =>
        fetch('/api/pomodoro/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task_id: taskId,
            duration: session.duration,
            type: 'work'
          }),
        })
      ));
    }

    const nextCycle = (pomodoroCycle + 1) % pomodoroSessions.length;
    setPomodoroCycle(nextCycle);
    setPomodoroTime(pomodoroSessions[nextCycle].duration);

    playBeep();
    addNotification(
      `${session.label.toUpperCase()} COMPLETE`,
      `Time for ${pomodoroSessions[nextCycle].label}. Click to start next session.`,
      session.type === 'work' ? 'success' : 'info'
    );
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title) return;

    // Associate task with the first connected account
    const account_email = connections[0]?.email;

    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newTask, account_email }),
    });
    setNewTask({ title: '', description: '', priority: 2, due_at: format(new Date(), "yyyy-MM-dd'T'HH:mm") });
    setIsAddingTask(false);
    fetchTasks();
    if (activeTab === 'schedule') {
      fetchEvents(currentDate, viewMode);
    }
  };

  const toggleTaskStatus = async (id: number) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchTasks();
  };

  const toggleTaskVisibility = async (id: number, isHidden: boolean) => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_hidden: isHidden }),
    });
    fetchTasks();
    if (activeTab === 'schedule') fetchEvents(currentDate, viewMode);
  };

  const updateTaskPriority = async (id: number, priority: number) => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    });
    fetchTasks();
  };

  const toggleWorkingArea = async (id: number, inWorkingArea: boolean) => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ in_working_area: inWorkingArea }),
    });
    fetchTasks();
  };

  const deleteTask = async (id: number) => {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    fetchTasks();
  };

  const acceptSuggestedTask = async (task: any) => {
    console.log('Accepting suggested task:', task);
    if (!task || !task.title) {
      console.error('Invalid task object:', task);
      return;
    }
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: task.title,
        description: task.steps && task.steps.length > 0
          ? `Recommended steps:\n${task.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}`
          : 'Added from briefing suggestions.',
        priority: task.priority || 2,
        due_at: format(new Date(), "yyyy-MM-dd'T'HH:mm")
      }),
    });
    if (res.ok) {
      const savedTask = await res.json();
      // Ensure we have a fresh fetch to avoid state sync issues
      fetchTasks();
      if (briefing) {
        setBriefing({
          ...briefing,
          tasksWithSteps: briefing.tasksWithSteps.map(t =>
            t.title === task.title ? { ...t, isSuggested: false, taskId: savedTask.id } : t
          )
        });
      }
    }
  };

  const updateBriefingTaskPriority = (index: number, priority: number) => {
    if (!briefing) return;
    const task = briefing.tasksWithSteps[index];

    if (task.taskId && !task.isSuggested) {
      updateTaskPriority(task.taskId, priority);
    }

    setBriefing({
      ...briefing,
      tasksWithSteps: briefing.tasksWithSteps.map((t, i) =>
        i === index ? { ...t, priority } : t
      )
    });
  };

  const generateBriefing = async () => {
    setIsLoadingBriefing(true);
    try {
      const topTasks = tasks.slice(0, 3);
      const data = await generateMorningBriefing(events, topTasks);
      setBriefing(data);

      // Show top tasks in persistent notification
      const morningTasks = data.tasksWithSteps.slice(0, 3);
      if (morningTasks.length > 0) {
        const taskList = morningTasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
        addNotification("Today's Focus", taskList, 'info', true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingBriefing(false);
    }
  };

  const getEventsWithLayout = (dayEvents: CalendarEvent[]) => {
    const sorted = [...dayEvents].sort((a, b) => {
      const startA = new Date(a.start.dateTime || a.start.date || '').getTime();
      const startB = new Date(b.start.dateTime || b.start.date || '').getTime();
      return startA - startB;
    });

    const groups: CalendarEvent[][] = [];
    let currentGroup: CalendarEvent[] = [];
    let groupEnd = 0;

    sorted.forEach(event => {
      const start = new Date(event.start.dateTime || event.start.date || '').getTime();
      const end = new Date(event.end.dateTime || event.end.date || '').getTime();

      if (start < groupEnd) {
        currentGroup.push(event);
        groupEnd = Math.max(groupEnd, end);
      } else {
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [event];
        groupEnd = end;
      }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    return groups.flatMap(group => {
      const columns: CalendarEvent[][] = [];
      group.forEach(event => {
        let placed = false;
        for (const col of columns) {
          const last = col[col.length - 1];
          const lastEnd = new Date(last.end.dateTime || last.end.date || '').getTime();
          const currentStart = new Date(event.start.dateTime || event.start.date || '').getTime();
          if (currentStart >= lastEnd) {
            col.push(event);
            placed = true;
            break;
          }
        }
        if (!placed) columns.push([event]);
      });

      return group.map(event => {
        const colIdx = columns.findIndex(c => c.includes(event));
        return {
          ...event,
          layout: {
            left: (colIdx / columns.length) * 100,
            width: (100 / columns.length)
          }
        };
      });
    });
  };

  const navigate = (direction: 'next' | 'prev') => {
    if (viewMode === 'day') {
      setCurrentDate(prev => direction === 'next' ? addDays(prev, 1) : subDays(prev, 1));
    } else if (viewMode === 'week') {
      setCurrentDate(prev => direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1));
    } else {
      setCurrentDate(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
    }
  };

  const getAccountColor = (email?: string) => {
    if (!email) return { bg: 'bg-stone-50', border: 'border-stone-500', text: 'text-stone-700', light: 'bg-stone-500/10' };
    const index = connections.findIndex(c => c.email === email);
    const colors = [
      { bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-700', light: 'bg-amber-500/10' },
      { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', light: 'bg-blue-500/10' },
      { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-500/10' },
      { bg: 'bg-rose-50', border: 'border-rose-500', text: 'text-rose-700', light: 'bg-rose-500/10' },
      { bg: 'bg-violet-50', border: 'border-violet-500', text: 'text-violet-700', light: 'bg-violet-500/10' },
    ];
    return colors[index === -1 ? 0 : index % colors.length];
  };

  if (isAuthenticated === null) return null;

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans">
      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 px-4 md:px-6 py-3 z-50 md:top-0 md:bottom-auto md:border-b md:border-t-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-semibold text-lg cursor-pointer shrink-0" onClick={() => setActiveTab('briefing')}>
            <Sparkles className="text-amber-500 w-5 h-5" />
            <span className="hidden sm:inline">DayStart AI</span>
          </div>

          <div className="flex items-center gap-4 md:gap-8 flex-1 justify-center md:flex-initial">
            <button
              onClick={() => setActiveTab('briefing')}
              className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'briefing' ? 'text-amber-600' : 'text-stone-400 hover:text-stone-600'}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Briefing</span>
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'schedule' ? 'text-amber-600' : 'text-stone-400 hover:text-stone-600'}`}
            >
              <CalendarDays className="w-5 h-5" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Schedule</span>
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'tasks' ? 'text-amber-600' : 'text-stone-400 hover:text-stone-600'}`}
            >
              <ListTodo className="w-5 h-5" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Tasks</span>
            </button>
            <button
              onClick={() => setActiveTab('pomodoro')}
              className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'pomodoro' ? 'text-amber-600' : 'text-stone-400 hover:text-stone-600'}`}
            >
              <Timer className="w-5 h-5" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Pomodoro</span>
            </button>
          </div>

          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsShowingConnections(true)}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-full text-xs font-medium hover:bg-stone-50 transition-all shadow-sm"
                title="Manage accounts"
              >
                <Grid className="w-4 h-4" />
                <span className="hidden md:inline">Accounts</span>
              </button>
              <button
                onClick={handleConnect}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-full text-xs font-medium hover:bg-stone-50 transition-all shadow-sm"
                title="Connect another account"
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden md:inline">Add Account</span>
              </button>
            </div>
          ) : (
            <button onClick={handleConnect} className="bg-stone-900 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-stone-800 transition-colors">
              Connect
            </button>
          )}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 pt-24 pb-32">
        <AnimatePresence mode="wait">
          {activeTab === 'briefing' && (
            <motion.div
              key="briefing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 max-w-4xl mx-auto"
            >
              {!isAuthenticated ? (
                <div className="bg-white rounded-3xl p-8 md:p-12 text-center space-y-6 shadow-sm border border-stone-100">
                  <div className="w-16 h-16 md:w-20 md:h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                    <CalendarIcon className="w-8 h-8 md:w-10 md:h-10 text-amber-500" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl md:text-3xl font-light tracking-tight">Connect your calendar</h2>
                    <p className="text-stone-500 text-sm md:text-base max-w-sm mx-auto">
                      To generate your morning briefing, we need to see what's on your schedule for today.
                    </p>
                  </div>
                  <button
                    onClick={handleConnect}
                    className="bg-stone-900 text-white px-6 md:px-8 py-3 md:py-4 rounded-full font-medium hover:bg-stone-800 transition-all transform hover:scale-105"
                  >
                    Connect Google Calendar
                  </button>
                </div>
              ) : !briefing ? (
                <div className="bg-white rounded-3xl p-8 md:p-12 text-center space-y-8 shadow-sm border border-stone-100">
                  <div className="space-y-4">
                    <h2 className="text-3xl md:text-4xl font-light tracking-tight">Good morning.</h2>
                    <p className="text-stone-500 text-sm md:text-base">Ready to see what your day looks like?</p>
                  </div>
                  <button
                    onClick={generateBriefing}
                    disabled={isLoadingBriefing}
                    className="bg-amber-500 text-white px-8 md:px-10 py-4 md:py-5 rounded-full font-bold text-base md:text-lg hover:bg-amber-600 transition-all shadow-lg shadow-amber-200 disabled:opacity-50 flex items-center gap-3 mx-auto"
                  >
                    {isLoadingBriefing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-6 h-6" />
                        <span>Start My Day</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-10">
                  {/* Hero Image & Encouragement */}
                  <div className="relative h-64 rounded-3xl overflow-hidden shadow-xl">
                    {briefing.imageUrl ? (
                      <img src={briefing.imageUrl} className="w-full h-full object-cover" alt="Morning inspiration" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-amber-100 to-orange-200" />
                    )}
                    <div className="absolute inset-0 bg-black/30 flex items-end p-6 md:p-8">
                      <p className="text-white text-lg md:text-2xl font-medium leading-tight max-w-xl">
                        "{briefing.encouragement}"
                      </p>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-stone-100">
                    <h3 className="text-stone-400 text-xs font-bold uppercase tracking-widest mb-4">Today's Outlook</h3>
                    <div className="prose prose-stone max-w-none">
                      <Markdown>{briefing.summary}</Markdown>
                    </div>
                  </div>

                  {/* Top 3 Tasks with Steps */}
                  <div className="space-y-6">
                    <div className="flex items-center px-2">
                      <h3 className="text-stone-400 text-xs font-bold uppercase tracking-widest">Your Top Priorities</h3>
                    </div>
                    {briefing.tasksWithSteps.map((task, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="bg-white rounded-3xl p-8 shadow-sm border border-stone-100 space-y-6"
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-4 flex-1">
                            <div className="flex items-center gap-2">
                              {task.isSuggested && (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-full">Proposed</span>
                              )}
                              <span className="text-amber-500 font-mono text-sm font-bold">0{idx + 1}</span>
                            </div>
                            <h4 className="text-xl font-semibold text-stone-900">{task.title}</h4>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Set Priority</span>
                              <div className="flex gap-1.5">
                                {[1, 2, 3].map(p => (
                                  <button
                                    key={p}
                                    onClick={() => updateBriefingTaskPriority(idx, p)}
                                    className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all ${task.priority === p ? 'bg-amber-500 text-white shadow-sm' : 'bg-stone-50 text-stone-400 hover:bg-stone-100'}`}
                                  >
                                    {p}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 pt-1 flex items-center gap-3">
                            {task.isSuggested ? (
                              <button
                                onClick={() => acceptSuggestedTask(task)}
                                className="flex items-center gap-2 bg-amber-500 text-white px-5 py-2.5 rounded-2xl text-xs font-bold hover:bg-amber-600 transition-all shadow-lg active:scale-95 group/btn"
                              >
                                <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform" />
                                <span>Add to Tasks</span>
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const existingTask = tasks.find(t => t.id === task.taskId);
                                  if (existingTask) {
                                    return (
                                      <button
                                        onClick={() => toggleWorkingArea(existingTask.id, !existingTask.in_working_area)}
                                        className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-95 ${existingTask.in_working_area
                                          ? 'bg-amber-500 text-white shadow-md'
                                          : 'bg-stone-100 text-stone-600 hover:bg-amber-500 hover:text-white'
                                          }`}
                                        title={existingTask.in_working_area ? "Remove from Working Area" : "Add to Working Area"}
                                      >
                                        {existingTask.in_working_area ? (
                                          <>
                                            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                            <span>In Focus</span>
                                          </>
                                        ) : (
                                          <>
                                            <HandMetal className="w-4 h-4" />
                                            <span>Focus</span>
                                          </>
                                        )}
                                      </button>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <p className="text-stone-400 text-xs font-bold uppercase tracking-wider">Actionable Steps</p>
                          <div className="grid gap-3">
                            {task.steps.map((step, sIdx) => (
                              <div key={sIdx} className="flex items-center gap-3 bg-stone-50 p-4 rounded-2xl border border-stone-100 group hover:border-amber-200 transition-colors">
                                <div className="w-6 h-6 rounded-full bg-white border border-stone-200 flex items-center justify-center text-[10px] font-bold text-stone-400 group-hover:bg-amber-500 group-hover:text-white group-hover:border-amber-500 transition-colors">
                                  {sIdx + 1}
                                </div>
                                <span className="text-stone-700 text-sm">{step}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <button
                    onClick={() => setBriefing(null)}
                    className="w-full py-4 text-stone-400 hover:text-stone-600 text-sm font-medium transition-colors"
                  >
                    Reset Briefing
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'schedule' && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-sm border border-stone-100">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-light tracking-tight min-w-[150px]">
                    {format(currentDate, viewMode === 'month' ? 'MMMM yyyy' : 'MMMM do')}
                  </h2>
                  <div className="flex bg-stone-100 p-1 rounded-xl">
                    <button onClick={() => navigate('prev')} className="p-2 hover:bg-white rounded-lg transition-all"><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1 text-xs font-bold uppercase tracking-wider hover:bg-white rounded-lg transition-all">Today</button>
                    <button onClick={() => navigate('next')} className="p-2 hover:bg-white rounded-lg transition-all"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <button
                    onClick={() => fetchEvents(currentDate, viewMode)}
                    className="p-2 text-stone-400 hover:text-amber-500 hover:bg-amber-50 rounded-xl transition-all group"
                    title="Sync Calendar"
                  >
                    <RefreshCw className="w-5 h-5 group-active:animate-spin" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex bg-stone-100 p-1.5 rounded-2xl">
                    {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${viewMode === mode ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setActiveTab('tasks'); setIsAddingTask(true); }}
                    className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-stone-800 transition-all shadow-md active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Task</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
                {viewMode === 'day' && (
                  <div className="divide-y divide-stone-100">
                    {Array.from({ length: 24 }).map((_, hour) => {
                      const hourEvents = events.filter(e => {
                        const start = new Date(e.start.dateTime || e.start.date || '');
                        return start.getHours() === hour && isSameDay(start, currentDate);
                      });

                      return (
                        <div key={hour} className="flex group">
                          <div className="w-20 py-8 pr-4 text-right">
                            <span className="text-[10px] font-bold text-stone-300 uppercase tracking-widest">
                              {format(setHours(new Date(), hour), 'HH:00')}
                            </span>
                          </div>
                          <div className="flex-1 py-4 px-4 relative min-h-[80px] flex gap-3 overflow-x-auto custom-scrollbar">
                            {hourEvents.map(event => {
                              const colors = getAccountColor(event.accountEmail);
                              return (
                                <div
                                  key={event.id}
                                  onClick={() => setSelectedEvent(event)}
                                  className={`flex-1 min-w-[150px] ${colors.bg} ${colors.border} border-l-4 p-3 rounded-xl hover:translate-y-[-2px] hover:shadow-md transition-all cursor-pointer shadow-sm h-fit`}
                                >
                                  <p className={`text-xs font-bold ${colors.text}`}>
                                    {event.start.dateTime ? format(new Date(event.start.dateTime), 'HH:mm') : 'All Day'}
                                  </p>
                                  <h4 className="font-semibold text-stone-900 text-sm">{event.summary}</h4>
                                </div>
                              );
                            })}
                            <div className="absolute top-0 left-0 right-0 h-px bg-stone-50 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {viewMode === 'week' && (
                  <div className="flex">
                    <div className="w-16 border-r border-stone-100 pt-16">
                      {Array.from({ length: 24 }).map((_, h) => (
                        <div key={h} className="h-20 text-[10px] font-bold text-stone-300 text-right pr-2">
                          {format(setHours(new Date(), h), 'HH:00')}
                        </div>
                      ))}
                    </div>
                    <div className="flex-1 grid grid-cols-7 divide-x divide-stone-100">
                      {eachDayOfInterval({
                        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
                        end: endOfWeek(currentDate, { weekStartsOn: 1 })
                      }).map((day, idx) => (
                        <div key={idx} className="flex flex-col">
                          <div className="py-4 text-center border-b border-stone-100">
                            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{format(day, 'EEE')}</p>
                            <p className={`text-lg font-light ${isToday(day) ? 'text-amber-500 font-bold' : ''}`}>{format(day, 'd')}</p>
                          </div>
                          <div className="relative h-[1920px]"> {/* 20px per hour * 24 * 4 for scaling? No let's keep it 80px per hour */}
                            {Array.from({ length: 24 }).map((_, h) => (
                              <div key={h} className="h-20 border-b border-stone-50/50" />
                            ))}
                            {getEventsWithLayout(events.filter(e => isSameDay(new Date(e.start.dateTime || e.start.date || ''), day))).map(event => {
                              const start = new Date(event.start.dateTime || event.start.date || '');
                              const top = start.getHours() * 80 + (start.getMinutes() / 60) * 80;
                              const colors = getAccountColor(event.accountEmail);
                              const layout = (event as any).layout;
                              return (
                                <div
                                  key={event.id}
                                  onClick={() => setSelectedEvent(event)}
                                  className={`absolute ${colors.light} ${colors.border} border-l-2 rounded-md p-1 overflow-hidden shadow-sm cursor-pointer hover:scale-[1.02] hover:z-10 transition-all`}
                                  style={{
                                    top: `${top}px`,
                                    minHeight: '30px',
                                    left: `${layout.left}%`,
                                    width: `${layout.width}%`
                                  }}
                                >
                                  <p className={`text-[9px] font-bold ${colors.text} truncate`}>{event.summary}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {viewMode === 'month' && (
                  <div className="grid grid-cols-7">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                      <div key={d} className="py-4 text-center text-[10px] font-bold text-stone-400 uppercase tracking-widest border-b border-stone-100">
                        {d}
                      </div>
                    ))}
                    {eachDayOfInterval({
                      start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }),
                      end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 })
                    }).map((day, idx) => {
                      const dayEvents = events.filter(e => isSameDay(new Date(e.start.dateTime || e.start.date || ''), day));
                      const isCurrentMonth = day.getMonth() === currentDate.getMonth();

                      return (
                        <div key={idx} className={`min-h-[120px] p-2 border-b border-r border-stone-100 relative ${!isCurrentMonth ? 'bg-stone-50/50' : ''}`}>
                          <div className={`text-xs font-bold mb-2 ${isToday(day) ? 'bg-amber-500 text-white w-6 h-6 rounded-full flex items-center justify-center' : isCurrentMonth ? 'text-stone-900' : 'text-stone-300'}`}>
                            {format(day, 'd')}
                          </div>
                          <div className="space-y-1">
                            {dayEvents.slice(0, 3).map(event => {
                              const colors = getAccountColor(event.accountEmail);
                              return (
                                <div
                                  key={event.id}
                                  onClick={(e) => { e.stopPropagation(); setSelectedEvent(event); }}
                                  className={`text-[9px] ${colors.bg} ${colors.text} ${colors.border} p-1 rounded truncate border-l-2 cursor-pointer hover:opacity-75`}
                                >
                                  {event.summary}
                                </div>
                              );
                            })}
                            {dayEvents.length > 3 && (
                              <div className="text-[9px] text-stone-400 font-bold pl-1">+{dayEvents.length - 3} more</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6 max-w-2xl mx-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-2">
                <h2 className="text-3xl font-light tracking-tight">Tasks</h2>
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsAddingTask(true)}
                    className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-stone-800 transition-all shadow-lg hover:scale-105 active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Task</span>
                  </button>
                </div>
              </div>

              {/* Working Area */}
              <div className="bg-amber-500/5 rounded-[32px] p-6 border border-amber-500/10 space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <HandMetal className="w-5 h-5 text-amber-500" />
                    <h3 className="text-sm font-bold text-amber-600 uppercase tracking-widest">Working Area</h3>
                  </div>
                  {tasks.filter(t => t.in_working_area).length > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setActiveTab('pomodoro')}
                        className="flex items-center gap-2 bg-amber-500 text-white px-3 py-1.5 rounded-xl text-[10px] font-bold hover:bg-amber-600 transition-all shadow-sm"
                      >
                        <Timer className="w-3 h-3" />
                        Start Session
                      </button>
                    </div>
                  )}
                </div>

                {tasks.filter(t => t.in_working_area).length === 0 ? (
                  <div className="bg-white/50 rounded-2xl p-8 text-center border border-dashed border-amber-200">
                    <p className="text-amber-600/60 text-sm">Add tasks here to focus on them</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tasks.filter(t => t.in_working_area).map((task) => (
                      <div
                        key={task.id}
                        onClick={() => setSelectedEvent({
                          id: `task-${task.id}`,
                          summary: task.title,
                          description: task.description,
                          isTask: true,
                          taskId: task.id,
                          priority: task.priority,
                          accountEmail: task.account_email,
                          start: { dateTime: task.due_at || new Date().toISOString() },
                          end: { dateTime: task.due_at || new Date().toISOString() }
                        })}
                        className={`bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm border border-stone-100 border-l-4 ${getAccountColor(task.account_email).border} group cursor-pointer hover:border-amber-200 transition-all`}
                      >
                        <div className="flex-1">
                          <h4 className="font-medium text-stone-900">{task.title}</h4>
                          {task.description && <p className="text-stone-400 text-xs line-clamp-1">{task.description}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveTab('pomodoro'); }}
                            className="p-2 text-amber-500 hover:bg-amber-50 rounded-xl transition-colors"
                            title="Go to Timer"
                          >
                            <div className="w-4 h-4 flex items-center justify-center">
                              <Timer className="w-4 h-4" />
                            </div>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleWorkingArea(task.id, false); }}
                            className="p-2 text-stone-400 hover:text-stone-600 transition-colors"
                            title="Remove from Working Area"
                          >
                            <div className="w-4 h-4 flex items-center justify-center">
                              <ChevronLeft className="w-4 h-4" />
                            </div>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Standard Tasks */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <ListTodo className="w-5 h-5 text-stone-400" />
                    <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest">Available Tasks</h3>
                  </div>
                  <button
                    onClick={() => {
                      tasks.filter(t => !t.in_working_area).forEach(t => toggleWorkingArea(t.id, true));
                    }}
                    className="text-[10px] font-bold text-stone-400 hover:text-amber-500 uppercase tracking-widest transition-colors"
                  >
                    Add All to focus
                  </button>
                </div>

                {isAddingTask && (
                  <motion.form
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onSubmit={addTask}
                    className="bg-white rounded-3xl p-8 shadow-xl border border-stone-100 space-y-4"
                  >
                    <div className="space-y-4">
                      <input
                        autoFocus
                        placeholder="What needs to be done?"
                        className="w-full text-xl font-medium outline-none placeholder:text-stone-300"
                        value={newTask.title}
                        onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                      />
                      <textarea
                        placeholder="Add a description (optional)"
                        className="w-full text-stone-500 outline-none resize-none h-20 placeholder:text-stone-200"
                        value={newTask.description}
                        onChange={e => setNewTask({ ...newTask, description: e.target.value })}
                      />
                      <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 space-y-2">
                          <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Schedule At</span>
                          <input
                            type="datetime-local"
                            className="w-full bg-stone-100 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500 transition-all font-medium"
                            value={newTask.due_at}
                            onChange={e => setNewTask({ ...newTask, due_at: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Priority</span>
                          <div className="flex gap-2">
                            {[1, 2, 3].map(p => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setNewTask({ ...newTask, priority: p })}
                                className={`w-10 h-10 rounded-xl text-xs font-bold transition-all ${newTask.priority === p
                                  ? 'bg-amber-500 text-white shadow-md'
                                  : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                                  }`}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3 pt-4">
                      <button
                        type="submit"
                        className="flex-1 bg-stone-900 text-white py-3 rounded-2xl font-medium hover:bg-stone-800 transition-colors"
                      >
                        Add Task
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddingTask(false)}
                        className="px-6 py-3 text-stone-400 font-medium hover:text-stone-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.form>
                )}

                {tasks.filter(t => !t.in_working_area).length === 0 ? (
                  <div className="bg-white rounded-3xl p-12 text-center space-y-4 border border-stone-100">
                    <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8 text-stone-300" />
                    </div>
                    <p className="text-stone-500">All tasks are in focus or completed!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tasks.filter(t => !t.in_working_area).map((task) => {
                      const colors = getAccountColor(task.account_email);
                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedEvent({
                            id: `task-${task.id}`,
                            summary: task.title,
                            description: task.description,
                            isTask: true,
                            taskId: task.id,
                            priority: task.priority,
                            accountEmail: task.account_email,
                            start: { dateTime: task.due_at || new Date().toISOString() },
                            end: { dateTime: task.due_at || new Date().toISOString() }
                          })}
                          className={`bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm border border-stone-100 border-l-4 ${colors.border} group cursor-pointer hover:border-amber-200 transition-all`}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleTaskStatus(task.id); }}
                            className="w-6 h-6 rounded-full border-2 border-stone-200 flex items-center justify-center hover:border-amber-500 transition-colors shrink-0"
                          >
                            <div className="w-3 h-3 rounded-full bg-amber-500 opacity-0 group-hover:opacity-20" />
                          </button>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-stone-900">{task.title}</h4>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${task.priority === 1 ? 'bg-red-50 text-red-500' :
                                task.priority === 2 ? 'bg-amber-50 text-amber-500' :
                                  'bg-stone-50 text-stone-400'
                                }`}>
                                P{task.priority}
                              </span>
                              {task.is_hidden && (
                                <span className="bg-purple-50 text-purple-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter">Hidden</span>
                              )}
                            </div>
                            {task.description && <p className="text-stone-400 text-sm line-clamp-1">{task.description}</p>}
                          </div>
                          <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleWorkingArea(task.id, true); }}
                              className="p-2 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Add to Working Area"
                            >
                              <HandMetal className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleTaskVisibility(task.id, !task.is_hidden); }}
                              className={`p-2 rounded-lg transition-colors ${task.is_hidden ? 'text-purple-500 bg-purple-50' : 'text-stone-300 hover:bg-stone-100'}`}
                              title={task.is_hidden ? "Show on Calendar" : "Hide from Calendar"}
                            >
                              <EyeOff className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                              className="p-2 text-stone-300 hover:text-red-400 transition-all font-bold"
                              title="Delete Task"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'pomodoro' && (
            <motion.div
              key="pomodoro"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8 py-8 md:py-12"
            >
              {/* Left Bar: Pomodoro Cycle */}
              <div className="space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100">
                  <h2 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-6 px-1">Timer Cycle</h2>
                  <div className="space-y-1">
                    {pomodoroSessions.map((session, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setPomodoroCycle(idx);
                          setPomodoroTime(session.duration);
                          setIsTimerRunning(false);
                        }}
                        className={`w-full text-left p-3 rounded-2xl transition-all group relative ${pomodoroCycle === idx ? 'bg-stone-900 text-white shadow-lg' : 'hover:bg-amber-50/50'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-1.5 h-1.5 rounded-full ${pomodoroCycle === idx ? 'bg-amber-500' : 'bg-stone-200 group-hover:bg-amber-400'}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-tight ${pomodoroCycle === idx ? 'text-white' : 'text-stone-400 group-hover:text-stone-600'}`}>
                            {session.label}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-amber-50/50 rounded-3xl p-6 border border-amber-100">
                  <div className="flex items-center gap-2 mb-4">
                    <Info className="w-4 h-4 text-amber-500" />
                    <h3 className="text-[10px] font-bold text-amber-900 uppercase tracking-widest">Auto-Queue</h3>
                  </div>
                  <p className="text-[10px] text-amber-700 font-medium leading-relaxed">
                    Tasks from your Working Area are automatically distributed across the 4 work sessions to keep your focus sharp.
                  </p>
                </div>
              </div>

              {/* Main Content */}
              <div className="max-w-xl mx-auto w-full space-y-12">
                <div className="text-center space-y-4">
                  <h2 className="text-sm font-bold text-stone-400 uppercase tracking-[0.2em]">{pomodoroSessions[pomodoroCycle].label}</h2>
                  <div className="relative inline-block">
                    <div className="text-[80px] md:text-[120px] font-medium text-stone-900 font-mono tracking-tighter leading-none">
                      {Math.floor(pomodoroTime / 60).toString().padStart(2, '0')}:
                      {(pomodoroTime % 60).toString().padStart(2, '0')}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-6">
                  <button
                    onClick={() => setIsTimerRunning(!isTimerRunning)}
                    className="w-20 h-20 md:w-24 md:h-24 bg-stone-900 text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl"
                  >
                    {isTimerRunning ? <Pause className="w-8 h-8 md:w-10 md:h-10" /> : <Play className="w-8 h-8 md:w-10 md:h-10 ml-1 md:ml-2" />}
                  </button>
                  <button
                    onClick={() => { setIsTimerRunning(false); setPomodoroTime(pomodoroSessions[pomodoroCycle].duration); }}
                    className="w-14 h-14 md:w-16 md:h-16 bg-stone-100 text-stone-400 rounded-full flex items-center justify-center hover:bg-stone-200 transition-all font-bold"
                  >
                    <RotateCcw className="w-5 h-5 md:w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between px-4 md:px-0">
                    <h3 className="text-xs font-bold text-stone-300 uppercase tracking-widest">Active Focus</h3>
                    {pomodoroSessions[pomodoroCycle].type === 'work' && (
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 px-2 py-1 rounded-full border border-amber-100">
                        {taskAssignments[pomodoroCycle]?.length || 0} Tasks Queued
                      </span>
                    )}
                  </div>
                  <div className="grid gap-4 px-4 md:px-0">
                    {pomodoroSessions[pomodoroCycle].type === 'rest' ? (
                      <div className="text-center p-12 bg-stone-50 rounded-3xl border border-stone-100">
                        <Coffee className="w-10 h-10 text-stone-200 mx-auto mb-4" />
                        <h4 className="text-stone-900 font-bold text-sm uppercase tracking-widest mb-1">Break Time</h4>
                        <p className="text-stone-400 text-xs">Step away and recharge your energy.</p>
                      </div>
                    ) : (taskAssignments[pomodoroCycle] || []).length === 0 ? (
                      <div className="text-center p-12 border-2 border-dashed border-stone-100 rounded-3xl">
                        <p className="text-stone-300 text-sm italic">No tasks assigned to this session</p>
                        <button onClick={() => setActiveTab('tasks')} className="mt-4 text-xs font-bold text-amber-500 uppercase tracking-wider">Queue up tasks</button>
                      </div>
                    ) : (
                      (taskAssignments[pomodoroCycle] || []).map(taskId => {
                        const task = tasks.find(t => t.id === taskId);
                        if (!task) return null;
                        return (
                          <div
                            key={task.id}
                            className="p-5 md:p-6 rounded-3xl text-left bg-white border border-stone-100 shadow-sm transition-all group"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-stone-900">{task.title}</h4>
                              <div className="flex gap-1">
                                {[0, 2, 4, 6].map(sessionIdx => (
                                  <button
                                    key={sessionIdx}
                                    onClick={() => {
                                      setTaskAssignments(prev => {
                                        const next = { ...prev };
                                        // Remove from current
                                        Object.keys(next).forEach(k => {
                                          next[Number(k)] = next[Number(k)].filter(id => id !== task.id);
                                        });
                                        // Add to new
                                        if (!next[sessionIdx]) next[sessionIdx] = [];
                                        next[sessionIdx].push(task.id);
                                        return next;
                                      });
                                    }}
                                    className={`w-5 h-5 rounded-md text-[8px] font-bold flex items-center justify-center transition-all ${taskAssignments[sessionIdx]?.includes(task.id) ? 'bg-stone-900 text-white' : 'bg-stone-50 text-stone-300 hover:bg-stone-100'}`}
                                  >
                                    W{([0, 2, 4, 6].indexOf(sessionIdx) + 1)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <p className="text-xs text-stone-400 line-clamp-2 leading-relaxed">{task.description || 'No additional details'}</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedEvent(null)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[32px] shadow-2xl overflow-hidden border border-stone-100 max-h-[90vh] flex flex-col"
            >
              <div className={`h-2.5 w-full shrink-0 ${selectedEvent.isTask ? 'bg-blue-500' : 'bg-amber-500'}`} />

              <div className="p-6 md:p-8 pb-4 flex items-start justify-between gap-4 border-b border-stone-50">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${selectedEvent.isTask ? 'bg-blue-50 text-blue-600' : `${getAccountColor(selectedEvent.accountEmail).bg} ${getAccountColor(selectedEvent.accountEmail).text}`
                      }`}>
                      {selectedEvent.isTask ? 'Task' : 'Meeting'}
                    </span>
                    {selectedEvent.priority && (
                      <span className="bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        P{selectedEvent.priority}
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-stone-900 leading-tight">
                    {selectedEvent.summary.replace(/^\[Task\]\s/, '')}
                  </h2>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!selectedEvent.isTask && (
                    <button
                      onClick={() => {
                        setNewTask({
                          title: selectedEvent.summary,
                          description: selectedEvent.description || '',
                          priority: 2,
                          due_at: format(new Date(selectedEvent.start.dateTime || selectedEvent.start.date || new Date()), "yyyy-MM-dd'T'HH:mm")
                        });
                        setActiveTab('tasks');
                        setIsAddingTask(true);
                        setSelectedEvent(null);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-600 rounded-xl text-xs font-bold hover:bg-amber-100 transition-all border border-amber-100 shadow-sm"
                      title="Add to Tasks"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="hidden sm:inline">To Tasks</span>
                    </button>
                  )}
                  {selectedEvent.isTask && (
                    <button
                      onClick={() => {
                        if (selectedEvent.taskId) toggleTaskVisibility(selectedEvent.taskId, !(selectedEvent as any).is_hidden);
                        setSelectedEvent(null);
                      }}
                      className={`p-2 rounded-full transition-colors ${(selectedEvent as any).is_hidden ? 'bg-purple-100 text-purple-600' : 'bg-stone-100 text-stone-400 hover:text-stone-600'}`}
                      title={(selectedEvent as any).is_hidden ? "Show on Calendar" : "Hide from Calendar"}
                    >
                      <EyeOff className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-stone-400" />
                  </button>
                </div>
              </div>

              <div className="p-6 md:p-8 pt-6 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
                <div className="grid gap-6">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-stone-50 rounded-xl shrink-0">
                      <Clock className="w-5 h-5 text-stone-400" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Time</p>
                      <p className="text-stone-700 font-medium">
                        {selectedEvent.start.dateTime
                          ? format(new Date(selectedEvent.start.dateTime), 'EEEE, MMM do')
                          : format(new Date(), 'EEEE, MMM do')}
                        <br />
                        <span className="text-stone-500">
                          {selectedEvent.start.dateTime && !selectedEvent.isTask
                            ? `${format(new Date(selectedEvent.start.dateTime), 'HH:mm')} - ${format(new Date(selectedEvent.end.dateTime || ''), 'HH:mm')}`
                            : selectedEvent.isTask ? 'Tasks have flexible timing' : 'All Day'
                          }
                        </span>
                      </p>
                    </div>
                  </div>

                  {selectedEvent.location && (
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-stone-50 rounded-xl shrink-0">
                        <MapPin className="w-5 h-5 text-stone-400" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Location</p>
                        <p className="text-stone-700 font-medium truncate">{selectedEvent.location}</p>
                      </div>
                    </div>
                  )}

                  {!selectedEvent.isTask && (
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-stone-50 rounded-xl shrink-0">
                        <Mail className="w-5 h-5 text-stone-400" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Account</p>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${getAccountColor(selectedEvent.accountEmail).bg.replace('-50', '-500')}`} />
                          <p className="text-stone-700 font-medium truncate">{selectedEvent.accountEmail || 'Primary'}</p>
                        </div>
                        <p className="text-[10px] text-stone-400 italic">{selectedEvent.calendarName}</p>
                      </div>
                    </div>
                  )}

                  {selectedEvent.description && (
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-stone-50 rounded-xl shrink-0">
                        <AlignLeft className="w-5 h-5 text-stone-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Description</p>
                        <div className="text-stone-600 text-sm bg-stone-50/50 p-4 rounded-2xl border border-stone-100 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">
                          {selectedEvent.description}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Connections Modal */}
      <AnimatePresence>
        {
          isShowingConnections && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsShowingConnections(false)}
                className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden border border-stone-100 flex flex-col"
              >
                <div className="p-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-stone-900">Connected Accounts</h2>
                    <button onClick={() => setIsShowingConnections(false)} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
                      <X className="w-5 h-5 text-stone-400" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {connections.length === 0 ? (
                      <div className="text-center py-8 space-y-2">
                        <div className="w-12 h-12 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                          <Mail className="w-6 h-6 text-stone-300" />
                        </div>
                        <p className="text-stone-400 text-sm">No accounts connected yet.</p>
                      </div>
                    ) : (
                      connections.map((conn) => {
                        const colors = getAccountColor(conn.email);
                        return (
                          <div key={conn.email} className="flex items-center justify-between p-4 bg-stone-50 rounded-2xl border border-stone-100 group">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${colors.border.replace('border-', 'bg-')}`} />
                              <div className="overflow-hidden">
                                <p className="text-sm font-semibold text-stone-900 truncate">{conn.email}</p>
                                <p className="text-[10px] text-stone-400 uppercase font-bold tracking-widest">Added {conn.updated_at ? format(new Date(conn.updated_at), 'MMM d, yyyy') : 'Recently'}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => removeConnection(conn.email)}
                              className="p-2 text-stone-300 hover:red-500 hover:bg-red-50 rounded-xl transition-all md:opacity-0 md:group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <button
                    onClick={() => { handleConnect(); setIsShowingConnections(false); }}
                    className="w-full py-4 flex items-center justify-center gap-2 bg-amber-500 text-white rounded-2xl font-bold hover:bg-amber-600 transition-all shadow-lg shadow-amber-200"
                  >
                    <UserPlus className="w-5 h-5" />
                    Add New Account
                  </button>
                </div>
              </motion.div>
            </div>
          )}
      </AnimatePresence>

      {/* Responsive Notifications Container */}
      <div className="fixed top-6 left-6 right-6 md:top-auto md:bottom-8 md:right-8 md:left-auto z-[200] flex flex-col gap-4 max-w-sm w-full pointer-events-none mx-auto md:mx-0">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: -50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className={`pointer-events-auto relative overflow-hidden bg-white/90 backdrop-blur-xl border border-stone-200 p-5 rounded-[24px] shadow-2xl ${n.type === 'success' ? 'border-l-4 border-l-green-500' :
                  n.type === 'warning' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-amber-500'
                }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{n.title}</h4>
                  <p className="text-stone-900 text-sm font-medium leading-relaxed whitespace-pre-wrap">{n.message}</p>
                </div>
                <button
                  onClick={() => setNotifications(prev => prev.filter(item => item.id !== n.id))}
                  className="p-1 hover:bg-stone-100 rounded-lg transition-colors shrink-0"
                >
                  <X className="w-4 h-4 text-stone-400" />
                </button>
              </div>
              {/* Progress bar for auto-dismissing notifications */}
              {!n.persistent && (
                <motion.div
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 5, ease: 'linear' }}
                  className="absolute bottom-0 left-0 h-1 bg-amber-500/20"
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div >
  );
}
