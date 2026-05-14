import React, { createContext, useContext, useState, useCallback } from 'react';

export type Notification = {
  id: string;
  app: string;
  appIcon: string;
  appColor: string;
  title: string;
  body: string;
  time: Date;
  read: boolean;
};

type NotifCtx = {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, 'id' | 'time' | 'read'>) => void;
  markAllRead: () => void;
  clearAll: () => void;
  dismiss: (id: string) => void;
};

const NotifContext = createContext<NotifCtx>({} as NotifCtx);
export const useNotifications = () => useContext(NotifContext);

const SEED: Notification[] = [
  { id: '1', app: 'Messages', appIcon: 'message-square', appColor: '#FF4B00', title: 'Alex Carter', body: 'Yeah, running great. Block height 849k+', time: new Date(Date.now() - 1000 * 60 * 5), read: false },
  { id: '2', app: 'IONA Node', appIcon: 'server', appColor: '#00FF41', title: 'Node Alpha synced', body: 'Block #849,002 committed. Consensus healthy.', time: new Date(Date.now() - 1000 * 60 * 12), read: false },
  { id: '3', app: 'Wallet', appIcon: 'credit-card', appColor: '#F59E0B', title: 'Transaction confirmed', body: '+500.00 IONA received from iona1abc...def', time: new Date(Date.now() - 1000 * 60 * 30), read: true },
  { id: '4', app: 'Messages', appIcon: 'message-square', appColor: '#FF4B00', title: 'Sarah Blake', body: 'Hey! Have you checked the IONA node?', time: new Date(Date.now() - 1000 * 60 * 60 * 2), read: true },
];

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>(SEED);

  const unreadCount = notifications.filter(n => !n.read).length;

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'time' | 'read'>) => {
    setNotifications(prev => [{
      ...n,
      id: String(Date.now()),
      time: new Date(),
      read: false,
    }, ...prev]);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return (
    <NotifContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, clearAll, dismiss }}>
      {children}
    </NotifContext.Provider>
  );
}
