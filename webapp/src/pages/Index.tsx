import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, MessageSquare, ChevronLeft, User, Bot, LogIn, LogOut, Loader2, Settings2, ListTodo, CheckSquare, Square, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import { useAgentConfig } from "@/hooks/useAgentConfig";
import { CustomizeAgentDialog } from "@/components/CustomizeAgentDialog";
import { useTodos } from "@/hooks/useTodos";
import { db } from "@/firebase.js";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

interface Conversation {
  id: string;
  date: Date;
  label: string;
  messages: Message[];
}

const TODAY_ID = "today";

function sessionLabel(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfSession = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfSession.getTime()) / 86400000);
  if (diffDays === 0) return `Today · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const Index = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"journal" | "todos">("journal");
  const [activeConversationId, setActiveConversationId] = useState<string>(TODAY_ID);
  const [pastSessions, setPastSessions] = useState<Conversation[]>([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { user, loading, signInWithGoogle, logout } = useAuth();
  const { agentConfig, saveAgentConfig } = useAgentConfig(user ?? null);
  const { todos, loadingTodos, markDone, markOpen, deleteTodo } = useTodos(user ?? null);
  const { isListening, isConnecting, isLoadingMemories, messages: agentMessages, error, toggleListening, sessionSavedAt } = useVoiceAgent(
    user?.displayName ?? null,
    user?.email ?? null,
    agentConfig.agentName,
    agentConfig.agentGender,
  );

  const fetchSessions = useCallback((email: string) => {
    const sessionsRef = collection(db, "conversations", email, "sessions");
    const q = query(sessionsRef, orderBy("timestamp", "desc"));
    getDocs(q)
      .then((snapshot) => {
        const sessions: Conversation[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          const date = new Date(data.timestamp as number);
          return {
            id: doc.id,
            date,
            label: sessionLabel(date),
            messages: (data.messages as Array<{ id: string; role: "user" | "assistant"; text: string; timestamp: string }>).map(
              (m) => ({ ...m, timestamp: new Date(m.timestamp) })
            ),
          };
        });
        setPastSessions(sessions);
      })
      .catch((e) => console.error("Failed to load sessions", e));
  }, []);

  // Fetch past sessions whenever the user changes.
  useEffect(() => {
    if (!user?.email) { setPastSessions([]); return; }
    fetchSessions(user.email);
  }, [user, fetchSessions]);

  // Re-fetch after each newly saved session.
  useEffect(() => {
    if (!sessionSavedAt || !user?.email) return;
    fetchSessions(user.email);
  }, [sessionSavedAt, user, fetchSessions]);

  // Merge today's live messages with fetched past sessions for the sidebar.
  const allConversations: Conversation[] = [
    {
      id: TODAY_ID,
      date: new Date(),
      label: "Today",
      messages: agentMessages as Message[],
    },
    ...pastSessions,
  ];

  const activeConversation =
    allConversations.find((c) => c.id === activeConversationId) ?? allConversations[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation.messages]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const isActive = isListening || isConnecting;

  // Show mic button only for "Today"; historical views are read-only.
  const isToday = activeConversationId === TODAY_ID;

  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-br from-[hsl(220,40%,95%)] via-[hsl(240,30%,92%)] to-[hsl(260,35%,90%)]">
      {/* Ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[hsl(260,60%,75%)] opacity-20 blur-[120px] pointer-events-none" />

      {/* Top bar — full width */}
      <header className="relative z-40 flex-shrink-0 flex items-center justify-between px-4 h-14 bg-white/60 backdrop-blur-2xl border-b border-[hsl(260,30%,85%)]/40">
        <div className="flex items-center gap-3">
          {activeTab === "journal" && (
            <button
              onClick={() => setSidebarOpen((p) => !p)}
              className="p-2 rounded-lg hover:bg-[hsl(260,30%,85%)]/40 transition-colors cursor-pointer"
            >
              {sidebarOpen
                ? <ChevronLeft size={20} className="text-[hsl(260,30%,40%)]" />
                : <MessageSquare size={20} className="text-[hsl(260,30%,40%)]" />}
            </button>
          )}
          <span className="text-base font-semibold tracking-tight text-[hsl(260,30%,30%)]">
            Voice Agent
          </span>
          {/* Tab switcher */}
          <div className="flex items-center gap-0.5 ml-2 p-0.5 rounded-xl bg-[hsl(260,30%,88%)]/50">
            <button
              onClick={() => setActiveTab("journal")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer",
                activeTab === "journal"
                  ? "bg-white text-[hsl(260,40%,40%)] shadow-sm"
                  : "text-[hsl(260,25%,55%)] hover:text-[hsl(260,30%,35%)]"
              )}
            >
              <MessageSquare size={13} />
              Journal
            </button>
            <button
              onClick={() => setActiveTab("todos")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer",
                activeTab === "todos"
                  ? "bg-white text-[hsl(260,40%,40%)] shadow-sm"
                  : "text-[hsl(260,25%,55%)] hover:text-[hsl(260,30%,35%)]"
              )}
            >
              <ListTodo size={13} />
              Todos
              {todos.filter(t => t.status === "open").length > 0 && (
                <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[hsl(260,50%,55%)] text-white text-[10px] flex items-center justify-center">
                  {todos.filter(t => t.status === "open").length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === "journal" && <span className="text-sm text-[hsl(260,25%,50%)]">{activeConversation.label}</span>}

          {!loading && (
            user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(260,50%,55%)] cursor-pointer">
                    <img
                      src={user.photoURL ?? ""}
                      alt={user.displayName ?? "User"}
                      className="w-8 h-8 rounded-full object-cover border-2 border-[hsl(260,50%,55%)]/40 hover:border-[hsl(260,50%,55%)]/80 transition-colors"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => setCustomizeOpen(true)}
                    className="gap-2 cursor-pointer"
                  >
                    <Settings2 size={15} className="text-[hsl(260,40%,55%)]" />
                    Customize Agent
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={logout}
                    className="gap-2 text-[hsl(0,60%,50%)] focus:text-[hsl(0,60%,45%)] cursor-pointer"
                  >
                    <LogOut size={15} />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="flex items-center gap-2 ml-3 px-4 py-1.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200
                  bg-[hsl(260,50%,55%)] text-white hover:bg-[hsl(260,50%,48%)] shadow-sm"
              >
                <LogIn size={16} />
                Login
              </button>
            )
          )}
        </div>
      </header>

      {/* Content row: sidebar + main */}
      <div className="relative flex flex-1 overflow-hidden">

        {/* ── TODOS TAB ─────────────────────────────────────────── */}
        {activeTab === "todos" && (
          <div className="flex-1 flex flex-col items-center overflow-hidden">
            <div className="w-full max-w-2xl flex-1 overflow-hidden px-4">
              <ScrollArea className="h-full">
                <div className="py-4 space-y-2">
                  {!user && !loading && (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                      <ListTodo size={36} className="text-[hsl(260,40%,65%)] opacity-50" />
                      <p className="text-sm text-[hsl(260,20%,55%)]">
                        Please <button onClick={signInWithGoogle} className="underline font-medium cursor-pointer">sign in</button> to see your todos.
                      </p>
                    </div>
                  )}
                  {user && loadingTodos && (
                    <div className="flex items-center justify-center h-48">
                      <Loader2 size={24} className="animate-spin text-[hsl(260,40%,65%)]" />
                    </div>
                  )}
                  {user && !loadingTodos && todos.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                      <ListTodo size={36} className="text-[hsl(260,40%,65%)] opacity-50" />
                      <p className="text-sm text-[hsl(260,20%,55%)]">
                        No todos yet.<br />They'll appear here after your next journal session.
                      </p>
                    </div>
                  )}
                  {user && !loadingTodos && todos.map((todo) => (
                    <div
                      key={todo.id}
                      className={cn(
                        "group flex items-start gap-3 px-4 py-3 rounded-2xl border transition-all duration-200",
                        todo.status === "closed"
                          ? "bg-white/40 border-[hsl(260,30%,88%)]/40 opacity-60"
                          : "bg-white/70 backdrop-blur-md border-[hsl(260,30%,85%)]/50"
                      )}
                    >
                      {/* Toggle done */}
                      <button
                        onClick={() => todo.status === "open" ? markDone(todo.id) : markOpen(todo.id)}
                        className="flex-shrink-0 mt-0.5 text-[hsl(260,40%,55%)] hover:text-[hsl(260,50%,45%)] transition-colors cursor-pointer"
                      >
                        {todo.status === "closed"
                          ? <CheckSquare size={18} />
                          : <Square size={18} />}
                      </button>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm text-[hsl(260,25%,25%)] leading-relaxed",
                          todo.status === "closed" && "line-through text-[hsl(260,15%,55%)]"
                        )}>
                          {todo.text}
                        </p>
                        <p className="text-[10px] text-[hsl(260,20%,60%)] mt-1">
                          {new Date(todo.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => deleteTodo(todo.id)}
                        className="flex-shrink-0 mt-0.5 text-[hsl(260,15%,65%)] hover:text-[hsl(0,60%,50%)] opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Day-wise conversation sidebar */}
        {activeTab === "journal" && <>
        <div
          className={cn(
            "absolute md:relative z-30 h-full transition-all duration-300 ease-in-out flex flex-col",
            "bg-white/60 backdrop-blur-2xl border-r border-[hsl(260,30%,85%)]/40",
            sidebarOpen ? "w-96 translate-x-0" : "w-0 -translate-x-full md:w-96 md:translate-x-0"
          )}
        >
          <div className="p-5 border-b border-[hsl(260,30%,85%)]/40 flex-shrink-0">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-[hsl(260,30%,40%)]">
              Journal
            </h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              {allConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    setActiveConversationId(conv.id);
                    setSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer",
                    "hover:bg-[hsl(260,40%,90%)]/60",
                    activeConversationId === conv.id
                      ? "bg-[hsl(260,50%,55%)]/10 border border-[hsl(260,50%,55%)]/20"
                      : "border border-transparent"
                  )}
                >
                  <p className="text-sm font-medium text-[hsl(260,30%,30%)]">{conv.label}</p>
                  <p className="text-xs text-[hsl(260,20%,55%)] mt-0.5 truncate">
                    {conv.messages.length > 0
                      ? conv.messages[conv.messages.length - 1]?.text
                      : "No entries yet — tap the mic to start"}
                  </p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/20 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content */}
        <div className="relative flex-1 flex flex-col items-center min-w-0 overflow-hidden">

          {/* Error banner */}
          {error && (
            <div className="w-full max-w-2xl mx-auto mt-3 px-4">
              <div className="px-4 py-2.5 rounded-xl bg-[hsl(0,60%,55%)]/10 border border-[hsl(0,60%,55%)]/20 text-sm text-[hsl(0,60%,40%)]">
                {error}
              </div>
            </div>
          )}

          {/* Login prompt when trying to use mic without auth */}
          {isToday && !user && !loading && (
            <div className="w-full max-w-2xl mx-auto mt-3 px-4">
              <div className="px-4 py-2.5 rounded-xl bg-[hsl(260,50%,55%)]/10 border border-[hsl(260,50%,55%)]/20 text-sm text-[hsl(260,30%,40%)]">
                Please <button onClick={signInWithGoogle} className="underline font-medium cursor-pointer">sign in</button> to use the voice journal.
              </div>
            </div>
          )}

          {/* Chat messages */}
          <div className="flex-1 w-full max-w-2xl overflow-hidden px-4">
            <ScrollArea className="h-full">
              <div className="py-4 space-y-4">
                {activeConversation.messages.length === 0 && isToday ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                    <Bot size={36} className="text-[hsl(260,40%,65%)] opacity-50" />
                    <p className="text-sm text-[hsl(260,20%,55%)]">
                      Your journal is empty today.<br />Tap the mic below to start your session.
                    </p>
                  </div>
                ) : (
                  activeConversation.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-3 items-start",
                        msg.role === "user" ? "flex-row-reverse" : "flex-row"
                      )}
                    >
                      {/* Avatar */}
                      <div
                        className={cn(
                          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                          msg.role === "user"
                            ? "bg-[hsl(260,50%,55%)]"
                            : "bg-[hsl(220,50%,55%)]"
                        )}
                      >
                        {msg.role === "user" ? (
                          <User size={16} color="white" />
                        ) : (
                          <Bot size={16} color="white" />
                        )}
                      </div>

                      {/* Bubble */}
                      <div
                        className={cn(
                          "max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                          msg.role === "user"
                            ? "bg-[hsl(260,50%,55%)] text-white rounded-tr-md"
                            : "bg-white/70 backdrop-blur-md text-[hsl(260,25%,25%)] border border-[hsl(260,30%,85%)]/50 rounded-tl-md"
                        )}
                      >
                        {msg.text}
                        <span
                          className={cn(
                            "block text-[10px] mt-1",
                            msg.role === "user" ? "text-white/60" : "text-[hsl(260,20%,60%)]"
                          )}
                        >
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </div>

          {/* Mic area — only visible for Today */}
          {isToday && (
            <div className="relative mb-12 mt-4 flex items-center justify-center flex-shrink-0">
              {/* Ripple rings */}
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full border border-[hsl(260,40%,60%)]/15"
                  style={{
                    width: `${100 + i * 50}px`,
                    height: `${100 + i * 50}px`,
                    animation: `ripple ${isActive ? 1.5 : 3}s ease-out ${i * (isActive ? 0.3 : 0.6)}s infinite`,
                  }}
                />
              ))}

              {/* Mic button */}
              <button
                onClick={user ? toggleListening : signInWithGoogle}
                disabled={isConnecting}
                className="relative z-10 flex items-center justify-center w-16 h-16 rounded-full backdrop-blur-xl transition-all duration-500 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                style={{
                  background: isListening
                    ? "linear-gradient(135deg, hsl(280, 70%, 55%), hsl(320, 70%, 55%))"
                    : "linear-gradient(135deg, hsl(260, 50%, 55%), hsl(220, 60%, 55%))",
                  boxShadow: isListening
                    ? "0 0 40px hsl(300, 70%, 50%, 0.35), 0 0 80px hsl(280, 70%, 50%, 0.15)"
                    : "0 0 30px hsl(260, 50%, 55%, 0.25), 0 0 60px hsl(220, 60%, 55%, 0.1)",
                  animation: isActive ? "breathe-active 1s ease-in-out infinite" : "breathe 2.5s ease-in-out infinite",
                }}
              >
                {isLoadingMemories ? (
                  <span className="text-[10px] tracking-wider uppercase font-light">Loading memories…</span>
                ) : isConnecting ? (
                  <Loader2 size={28} className="animate-spin" color="hsl(0, 0%, 100%)" />
                ) : isListening ? (
                  <MicOff size={28} className="transition-colors duration-300" color="hsl(0, 0%, 100%)" />
                ) : (
                  <Mic size={28} className="transition-colors duration-300" color="hsl(0, 0%, 100%)" />
                )}
              </button>

              {/* Status text */}
              <span className="absolute -bottom-8 text-xs tracking-widest uppercase text-[hsl(260,30%,45%)]/60 font-light">
                {isConnecting ? "Loading memories…" : isListening ? "Tap to stop" : "Tap to speak"}
              </span>
            </div>
          )}
        </div>
        </>}
      </div>

      {user && (
        <CustomizeAgentDialog
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          currentConfig={agentConfig}
          onSave={saveAgentConfig}
        />
      )}
    </div>
  );
};

export default Index;
