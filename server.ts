import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import session from "express-session";
import dotenv from "dotenv";
import { generateServerBriefing } from "./serverGemini";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("daystart.db");

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pending',
    due_at DATETIME,
    in_working_area INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    account_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS connections (
    email TEXT PRIMARY KEY,
    tokens TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    duration INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'work', 'short_break', 'long_break'
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS system_notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- 'morning_briefing', 'nightly_commitment'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    shown INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_focus (
    date TEXT PRIMARY KEY,
    task_ids TEXT NOT NULL, -- JSON array of IDs
    hash TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations
try {
  const tableInfo = db.prepare("PRAGMA table_info(tasks)").all() as any[];
  if (!tableInfo.some(col => col.name === 'due_at')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN 'due_at' DATETIME").run();
  }
  if (!tableInfo.some(col => col.name === 'in_working_area')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN 'in_working_area' INTEGER DEFAULT 0").run();
  }
  if (!tableInfo.some(col => col.name === 'is_hidden')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN 'is_hidden' INTEGER DEFAULT 0").run();
  }
  if (!tableInfo.some(col => col.name === 'account_email')) {
    db.prepare("ALTER TABLE tasks ADD COLUMN 'account_email' TEXT").run();
  }
} catch (e: any) {
  console.error("Migration failed:", e.message);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: "daystart-secret-123",
      resave: false,
      saveUninitialized: true,
      cookie: {
        secure: false,
        sameSite: 'lax',
        httpOnly: true
      },
    })
  );

  // --- OAuth Configuration ---
  const getOAuthClient = (req: express.Request) => {
    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    const redirectUri = `${appUrl}/auth/callback`;

    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  };

  // --- API Routes ---

  // Auth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const oauth2Client = getOAuthClient(req);
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email"
      ],
      prompt: "consent",
    });
    res.json({ url });
  });

  app.get("/auth/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided");

    try {
      const oauth2Client = getOAuthClient(req);
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email;

      if (email) {
        db.prepare("INSERT OR REPLACE INTO connections (email, tokens) VALUES (?, ?)").run(email, JSON.stringify(tokens));
        (req.session as any).tokens = tokens; // Keep for compatibility
      }

      res.send(`
        <html>
          <body style="background: transparent;">
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              }
              window.close();
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Error exchanging code:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/status", async (req, res) => {
    try {
      // Migration: If session has tokens, migrate them to the connections table
      const sessionTokens = (req.session as any).tokens;
      if (sessionTokens) {
        const oauth2Client = getOAuthClient(req);
        oauth2Client.setCredentials(sessionTokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        if (email) {
          db.prepare("INSERT OR REPLACE INTO connections (email, tokens) VALUES (?, ?)").run(email, JSON.stringify(sessionTokens));
          // Once migrated, clear from session to prevent repeated migration
          delete (req.session as any).tokens;
        }
      }

      const existing = db.prepare("SELECT count(*) as count FROM connections").get() as any;
      res.json({ isAuthenticated: existing.count > 0 });
    } catch (e) {
      console.error("Auth status error:", e);
      res.json({ isAuthenticated: false });
    }
  });

  app.get("/api/auth/connections", (req, res) => {
    const connections = db.prepare("SELECT email, updated_at FROM connections").all();
    res.json(connections);
  });

  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM connections").run(); // Clear all for now
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.delete("/api/auth/connections/:email", (req, res) => {
    const { email } = req.params;
    db.prepare("DELETE FROM connections WHERE email = ?").run(email);
    res.json({ success: true });
  });

  // --- Notification Routes (for System Tray) ---
  app.post("/api/notifications/briefing", (req, res) => {
    const { tasks } = req.body;
    if (!tasks || !Array.isArray(tasks)) return res.status(400).json({ error: "Invalid tasks" });

    const message = tasks.map((t: any, i: number) => `${i + 1}. ${t.title}`).join('\n');
    const id = `briefing-${new Date().toISOString().split('T')[0]}`;

    db.prepare(`
      INSERT OR REPLACE INTO system_notifications (id, type, title, message, shown)
      VALUES (?, ?, ?, ?, 0)
    `).run(id, 'morning_briefing', "Today's Focus", message);

    res.json({ success: true });
  });

  app.get("/api/notifications/tray", (req, res) => {
    const pending = db.prepare("SELECT * FROM system_notifications WHERE shown = 0 ORDER BY created_at ASC").all();

    // Mark them as shown once retrieved by the tray
    if (pending.length > 0) {
      const ids = pending.map((p: any) => p.id);
      db.prepare(`UPDATE system_notifications SET shown = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    res.json(pending);
  });

  app.post("/api/briefing/focus", (req, res) => {
    const { taskIds } = req.body; // Array of IDs
    if (!taskIds || !Array.isArray(taskIds)) return res.status(400).json({ error: "Invalid taskIds" });

    const date = new Date().toISOString().split('T')[0];
    const hash = taskIds.sort().join(',');

    // Check if changed
    const existing = db.prepare("SELECT hash FROM daily_focus WHERE date = ?").get(date) as any;

    if (!existing || existing.hash !== hash) {
      db.prepare("INSERT OR REPLACE INTO daily_focus (date, task_ids, hash) VALUES (?, ?, ?)").run(date, JSON.stringify(taskIds), hash);

      // Trigger a new notification for the tray
      const tasks = db.prepare(`SELECT title FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds);
      const message = tasks.map((t: any, i: number) => `${i + 1}. ${t.title}`).join('\n');
      const id = `briefing-${date}-${Date.now()}`; // Unique ID to force re-show

      db.prepare(`
        INSERT INTO system_notifications (id, type, title, message, shown)
        VALUES (?, ?, ?, ?, 0)
      `).run(id, 'morning_briefing', "Today's Focus Updated", message);
    }

    res.json({ success: true });
  });

  // Proactive Briefing Logic
  async function initializeDailyBriefing() {
    const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    const existing = db.prepare("SELECT date FROM daily_focus WHERE date = ?").get(date);

    if (!existing) {
      console.log("Proactively initializing briefing for", date);

      // Fetch tasks for today (including commitments)
      const tasks = db.prepare("SELECT * FROM tasks WHERE status = 'pending' AND is_hidden = 0").all() as any[];

      // Fetch recent sessions or events? For now, let's use tasks.
      // We can expand this to fetch calendar events if we want to be more thorough,
      // but tasks are the core of the morning briefing.

      try {
        const briefing = await generateServerBriefing([], tasks, "");
        if (briefing) {
          console.log("Briefing generated successfully");
          const taskIds = briefing.tasksWithSteps
            .map((t: any) => {
              const matchedTask = tasks.find(actualTask => actualTask.title === t.title);
              return matchedTask ? matchedTask.id : null;
            })
            .filter((id: any) => id !== null);

          const hash = taskIds.sort().join(',');
          db.prepare("INSERT OR REPLACE INTO daily_focus (date, task_ids, hash) VALUES (?, ?, ?)").run(date, JSON.stringify(taskIds), hash);

          const message = briefing.tasksWithSteps.map((t: any, i: number) => `${i + 1}. ${t.title}`).join('\n');
          const id = `briefing-${date}`;

          db.prepare(`
            INSERT OR REPLACE INTO system_notifications (id, type, title, message, shown)
            VALUES (?, ?, ?, ?, 0)
          `).run(id, 'morning_briefing', "Good Morning! Today's Focus", message);

          console.log("Proactive briefing notification queued for tray.");
        }
      } catch (err) {
        console.error("Proactive briefing generation failed:", err);
      }
    }
  }

  initializeDailyBriefing();

  // Calendar Routes
  app.get("/api/calendar/events", async (req, res) => {
    const connections = db.prepare("SELECT * FROM connections").all() as any[];
    if (connections.length === 0) return res.json([]); // Return empty list if not authenticated

    try {
      const { timeMin, timeMax } = req.query;
      const now = new Date();
      const defaultStart = new Date(now.setHours(0, 0, 0, 0)).toISOString();
      const defaultEnd = new Date(now.setHours(23, 59, 59, 999)).toISOString();

      const tMin = (timeMin as string) || defaultStart;
      const tMax = (timeMax as string) || defaultEnd;

      let allEvents: any[] = [];

      // Fetch Tasks that have a due_at within this range AND belong to an active connection
      const emails = connections.map(c => c.email);
      const placeholders = emails.map(() => '?').join(',');
      const tasks = db.prepare(`SELECT * FROM tasks WHERE (account_email IN (${placeholders}) OR account_email IS NULL) AND (due_at BETWEEN ? AND ?) AND status = 'pending' AND is_hidden = 0`).all(...emails, tMin, tMax) as any[];
      const taskEvents = tasks.map(task => ({
        id: `task-${task.id}`,
        summary: `[Task] ${task.title}`,
        description: task.description,
        isTask: true,
        taskId: task.id,
        start: { dateTime: task.due_at },
        end: { dateTime: new Date(new Date(task.due_at).getTime() + 30 * 60000).toISOString() }, // Default 30m
        priority: task.priority
      }));

      for (const conn of connections) {
        const tokens = JSON.parse(conn.tokens);
        const oauth2Client = getOAuthClient(req);
        oauth2Client.setCredentials(tokens);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });

        // Get list of all calendars for this account
        const calendarList = await calendar.calendarList.list();

        const fetchPromises = (calendarList.data.items || []).map(async (cal) => {
          try {
            const response = await calendar.events.list({
              calendarId: cal.id || 'primary',
              timeMin: tMin,
              timeMax: tMax,
              singleEvents: true,
              orderBy: "startTime",
            });
            return (response.data.items || []).map(event => ({
              ...event,
              calendarName: cal.summary,
              accountEmail: conn.email
            }));
          } catch (e) {
            console.error(`Error fetching calendar ${cal.id} for account ${conn.email}:`, e);
            return [];
          }
        });

        const accountEvents = await Promise.all(fetchPromises);
        allEvents = [...allEvents, ...accountEvents.flat()];
      }

      // Merge tasks and events
      allEvents = [...allEvents, ...taskEvents];

      // Sort merged events by start time
      allEvents.sort((a, b) => {
        const startA = new Date(a.start.dateTime || a.start.date || '').getTime();
        const startB = new Date(b.start.dateTime || b.start.date || '').getTime();
        return startA - startB;
      });

      res.json(allEvents);
    } catch (error) {
      console.error("Error fetching calendar:", error);
      res.status(500).json({ error: "Failed to fetch calendar" });
    }
  });

  // Task Routes
  app.get("/api/tasks", (req, res) => {
    const connections = db.prepare("SELECT email FROM connections").all() as any[];
    const emails = connections.map(c => c.email);
    if (emails.length === 0) return res.json([]);

    const placeholders = emails.map(() => '?').join(',');
    const tasks = db.prepare(`SELECT * FROM tasks WHERE (account_email IN (${placeholders}) OR account_email IS NULL) AND status = 'pending' ORDER BY priority ASC, created_at DESC`).all(...emails);
    res.json(tasks);
  });

  app.post("/api/tasks", (req, res) => {
    const { title, description, priority, due_at, account_email } = req.body;
    const info = db.prepare("INSERT INTO tasks (title, description, priority, due_at, account_email) VALUES (?, ?, ?, ?, ?)").run(title, description, priority || 2, due_at || null, account_email || null);
    res.json({ id: info.lastInsertRowid });
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const { id } = req.params;
    const { status, priority, title, description, due_at, in_working_area, is_hidden } = req.body;

    if (status !== undefined) {
      db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
    } else if (in_working_area !== undefined) {
      db.prepare("UPDATE tasks SET in_working_area = ? WHERE id = ?").run(in_working_area ? 1 : 0, id);
    } else if (is_hidden !== undefined) {
      db.prepare("UPDATE tasks SET is_hidden = ? WHERE id = ?").run(is_hidden ? 1 : 0, id);
    } else {
      db.prepare("UPDATE tasks SET priority = ?, title = ?, description = ?, due_at = ? WHERE id = ?")
        .run(priority, title, description, due_at, id);
    }
    res.json({ success: true });
  });

  app.post("/api/pomodoro/sessions", (req, res) => {
    const { task_id, duration, type } = req.body;
    db.prepare("INSERT INTO pomodoro_sessions (task_id, duration, type) VALUES (?, ?, ?)")
      .run(task_id || null, duration, type);
    res.json({ success: true });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
