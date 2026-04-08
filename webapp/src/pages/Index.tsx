import { useState, useRef, useEffect } from "react";
import { Mic, MessageSquare, ChevronLeft, User, Bot, LogIn, LogOut } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

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

const sampleConversations: Conversation[] = [
  {
    id: "1",
    date: new Date(),
    label: "Today",
    messages: [
      { id: "1a", role: "user", text: "Hey, what's the weather like today?", timestamp: new Date(Date.now() - 300000) },
      { id: "1b", role: "assistant", text: "It's currently 22°C and sunny in your area. Perfect day to be outside!", timestamp: new Date(Date.now() - 290000) },
      { id: "1c", role: "user", text: "Should I carry an umbrella?", timestamp: new Date(Date.now() - 200000) },
      { id: "1d", role: "assistant", text: "No need! There's less than 5% chance of rain today. You're all clear.", timestamp: new Date(Date.now() - 190000) },
    ],
  },
  {
    id: "2",
    date: new Date(Date.now() - 86400000),
    label: "Yesterday",
    messages: [
      { id: "2a", role: "user", text: "Remind me to call the dentist tomorrow.", timestamp: new Date(Date.now() - 86400000) },
      { id: "2b", role: "assistant", text: "Done! I've set a reminder for tomorrow morning at 9 AM to call the dentist.", timestamp: new Date(Date.now() - 86390000) },
    ],
  },
  {
    id: "3",
    date: new Date(Date.now() - 172800000),
    label: "2 days ago",
    messages: [
      { id: "3a", role: "user", text: "What's 15% of 240?", timestamp: new Date(Date.now() - 172800000) },
      { id: "3b", role: "assistant", text: "15% of 240 is 36.", timestamp: new Date(Date.now() - 172790000) },
      { id: "3c", role: "user", text: "And 20%?", timestamp: new Date(Date.now() - 172700000) },
      { id: "3d", role: "assistant", text: "20% of 240 is 48.", timestamp: new Date(Date.now() - 172690000) },
    ],
  },
  {
    id: "4",
    date: new Date(Date.now() - 432000000),
    label: "5 days ago",
    messages: [
      { id: "4a", role: "user", text: "Play some relaxing music.", timestamp: new Date(Date.now() - 432000000) },
      { id: "4b", role: "assistant", text: "Playing 'Calm Piano Collection' on your default music app. Enjoy!", timestamp: new Date(Date.now() - 431990000) },
    ],
  },
];

const Index = () => {
  const [isListening, setIsListening] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeConversation, setActiveConversation] = useState<Conversation>(sampleConversations[0]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { user, loading, signInWithGoogle, logout } = useAuth();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-br from-[hsl(220,40%,95%)] via-[hsl(240,30%,92%)] to-[hsl(260,35%,90%)]">
      {/* Ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[hsl(260,60%,75%)] opacity-20 blur-[120px] pointer-events-none" />

      {/* Top bar — full width */}
      <header className="relative z-40 flex-shrink-0 flex items-center justify-between px-4 h-14 bg-white/60 backdrop-blur-2xl border-b border-[hsl(260,30%,85%)]/40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((p) => !p)}
            className="p-2 rounded-lg hover:bg-[hsl(260,30%,85%)]/40 transition-colors cursor-pointer"
          >
            {sidebarOpen
              ? <ChevronLeft size={20} className="text-[hsl(260,30%,40%)]" />
              : <MessageSquare size={20} className="text-[hsl(260,30%,40%)]" />}
          </button>
          <span className="text-base font-semibold tracking-tight text-[hsl(260,30%,30%)]">
            Voice Agent
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-[hsl(260,25%,50%)]">{activeConversation.label}</span>

          {!loading && user && (
            <img
              src={user.photoURL ?? ""}
              alt={user.displayName ?? "User"}
              className="w-8 h-8 rounded-full object-cover border-2 border-[hsl(260,50%,55%)]/40"
              referrerPolicy="no-referrer"
            />
          )}

          {!loading && (
            user ? (
              <button
                onClick={logout}
                className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200
                  bg-[hsl(0,60%,55%)] text-white hover:bg-[hsl(0,60%,48%)] shadow-sm"
              >
                <LogOut size={16} />
                Logout
              </button>
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

        {/* Day-wise conversation sidebar */}
        <div
          className={cn(
            "absolute md:relative z-30 h-full transition-all duration-300 ease-in-out flex flex-col",
            "bg-white/60 backdrop-blur-2xl border-r border-[hsl(260,30%,85%)]/40",
            sidebarOpen ? "w-96 translate-x-0" : "w-0 -translate-x-full md:w-96 md:translate-x-0"
          )}
        >
          <div className="p-5 border-b border-[hsl(260,30%,85%)]/40 flex-shrink-0">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-[hsl(260,30%,40%)]">
              Conversations
            </h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              {sampleConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    setActiveConversation(conv);
                    setSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer",
                    "hover:bg-[hsl(260,40%,90%)]/60",
                    activeConversation.id === conv.id
                      ? "bg-[hsl(260,50%,55%)]/10 border border-[hsl(260,50%,55%)]/20"
                      : "border border-transparent"
                  )}
                >
                  <p className="text-sm font-medium text-[hsl(260,30%,30%)]">{conv.label}</p>
                  <p className="text-xs text-[hsl(260,20%,55%)] mt-0.5 truncate">
                    {conv.messages[conv.messages.length - 1]?.text}
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

        {/* Chat messages */}
        <div className="flex-1 w-full max-w-2xl overflow-hidden px-4">
          <ScrollArea className="h-full">
            <div className="py-4 space-y-4">
              {activeConversation.messages.map((msg) => (
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
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Mic area */}
        <div className="relative mb-12 mt-4 flex items-center justify-center flex-shrink-0">
          {/* Ripple rings */}
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full border border-[hsl(260,40%,60%)]/15"
              style={{
                width: `${100 + i * 50}px`,
                height: `${100 + i * 50}px`,
                animation: `ripple ${isListening ? 1.5 : 3}s ease-out ${i * (isListening ? 0.3 : 0.6)}s infinite`,
              }}
            />
          ))}

          {/* Mic button */}
          <button
            onClick={() => setIsListening((prev) => !prev)}
            className="relative z-10 flex items-center justify-center w-16 h-16 rounded-full backdrop-blur-xl transition-all duration-500 cursor-pointer"
            style={{
              background: isListening
                ? "linear-gradient(135deg, hsl(280, 70%, 55%), hsl(320, 70%, 55%))"
                : "linear-gradient(135deg, hsl(260, 50%, 55%), hsl(220, 60%, 55%))",
              boxShadow: isListening
                ? "0 0 40px hsl(300, 70%, 50%, 0.35), 0 0 80px hsl(280, 70%, 50%, 0.15)"
                : "0 0 30px hsl(260, 50%, 55%, 0.25), 0 0 60px hsl(220, 60%, 55%, 0.1)",
              animation: isListening ? "breathe-active 1s ease-in-out infinite" : "breathe 2.5s ease-in-out infinite",
            }}
          >
            <Mic size={28} className="transition-colors duration-300" color="hsl(0, 0%, 100%)" />
          </button>

          {/* Status text */}
          <span className="absolute -bottom-8 text-xs tracking-widest uppercase text-[hsl(260,30%,45%)]/60 font-light">
            {isListening ? "Listening…" : "Tap to speak"}
          </span>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
