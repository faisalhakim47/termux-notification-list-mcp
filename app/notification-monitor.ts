import { z } from 'zod';
import { EventEmitter } from 'events';

// Notification structure based on termux-notification-list output
export const NotificationSchema = z.object({
  id: z.number(),
  tag: z.string(),
  key: z.string(),
  group: z.string(),
  packageName: z.string(),
  title: z.string(),
  content: z.string(),
  when: z.string(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export abstract class NotificationMonitor extends EventEmitter {
  protected isMonitoring = false;
  protected lastKnownNotifications: Notification[] = [];
  protected pollInterval: NodeJS.Timeout | null = null;
  
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = true;
    this.pollForNotifications();
  }
  
  stopMonitoring(): void {
    this.isMonitoring = false;
    
    this.cleanupMonitoring();
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
  
  protected abstract cleanupMonitoring(): void;
  
  private async pollForNotifications(): Promise<void> {
    if (!this.isMonitoring) return;
    
    try {
      const currentNotifications = await this.getCurrentNotifications();
      const newNotifications = this.findNewNotifications(currentNotifications);
      
      // Emit new notifications
      for (const notification of newNotifications) {
        this.emit('newNotification', notification);
      }
      
      this.lastKnownNotifications = currentNotifications;
    } catch (error) {
      this.emit('error', error);
    }
    
    // Schedule next poll (every 2 seconds)
    if (this.isMonitoring) {
      this.pollInterval = setTimeout(() => this.pollForNotifications(), 2000);
    }
  }
  
  private findNewNotifications(currentNotifications: Notification[]): Notification[] {
    const lastKnownKeys = new Set(this.lastKnownNotifications.map(n => n.key));
    return currentNotifications.filter(notification => !lastKnownKeys.has(notification.key));
  }
  
  abstract getCurrentNotifications(): Promise<Notification[]>;
}
