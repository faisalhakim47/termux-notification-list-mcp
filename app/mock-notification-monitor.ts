import { NotificationMonitor, Notification } from './notification-monitor.js';

export class MockNotificationMonitor extends NotificationMonitor {
  private mockNotifications: Notification[] = [];
  private simulateError = false;
  
  protected cleanupMonitoring(): void {
    // No cleanup needed for mock implementation
  }
  
  async getCurrentNotifications(): Promise<Notification[]> {
    if (this.simulateError) {
      throw new Error('Mock error for testing');
    }
    return [...this.mockNotifications];
  }
  
  // Test helper methods
  setMockNotifications(notifications: Notification[]): void {
    this.mockNotifications = notifications;
  }
  
  addMockNotification(notification: Notification): void {
    this.mockNotifications.push(notification);
  }
  
  clearMockNotifications(): void {
    this.mockNotifications = [];
  }
  
  setSimulateError(shouldError: boolean): void {
    this.simulateError = shouldError;
  }
  
  // Simulate a new notification arriving
  simulateNewNotification(notification: Notification): void {
    this.addMockNotification(notification);
    this.emit('newNotification', notification);
  }
}
