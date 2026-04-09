import { useState, useEffect, useCallback } from "react";
import {
  collection,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/firebase.js";
import type { User } from "firebase/auth";

export type TodoStatus = "open" | "closed";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  timestamp: number;
  sourceSessionId: string;
}

export function useTodos(user: User | null) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loadingTodos, setLoadingTodos] = useState(false);

  useEffect(() => {
    if (!user?.email) {
      setTodos([]);
      return;
    }

    setLoadingTodos(true);
    const q = query(
      collection(db, "todos", user.email, "items"),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: TodoItem[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            text: data.text as string,
            status: data.status as TodoStatus,
            timestamp: data.timestamp as number,
            sourceSessionId: data.sourceSessionId as string,
          };
        });
        setTodos(items);
        setLoadingTodos(false);
      },
      (err) => {
        console.error("Failed to load todos", err);
        setLoadingTodos(false);
      }
    );

    return unsubscribe;
  }, [user]);

  const markDone = useCallback(
    async (todoId: string) => {
      if (!user?.email) return;
      const ref = doc(db, "todos", user.email, "items", todoId);
      await updateDoc(ref, { status: "closed" });
    },
    [user]
  );

  const markOpen = useCallback(
    async (todoId: string) => {
      if (!user?.email) return;
      const ref = doc(db, "todos", user.email, "items", todoId);
      await updateDoc(ref, { status: "open" });
    },
    [user]
  );

  const deleteTodo = useCallback(
    async (todoId: string) => {
      if (!user?.email) return;
      const ref = doc(db, "todos", user.email, "items", todoId);
      await deleteDoc(ref);
    },
    [user]
  );

  return { todos, loadingTodos, markDone, markOpen, deleteTodo };
}
