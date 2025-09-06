import { spawn, ChildProcess } from 'child_process';
import { z } from 'zod';
import { NotificationMonitor, Notification, NotificationSchema } from './notification-monitor.js';

export class TermuxNotificationMonitor extends NotificationMonitor {
  private monitorProcess: ChildProcess | null = null;
  private commandOverride?: string;
  
  constructor(commandOverride?: string) {
    super();
    this.commandOverride = commandOverride || process.env.TERMUX_NOTIFICATION_LIST_CMD;
  }
  
  protected cleanupMonitoring(): void {
    if (this.monitorProcess) {
      this.monitorProcess.kill();
      this.monitorProcess = null;
    }
  }
  
  async getCurrentNotifications(): Promise<Notification[]> {
    return new Promise((resolve, reject) => {
      let process: ChildProcess;
      
      if (this.commandOverride) {
        // Use shell to execute the override command (e.g., SSH command)
        process = spawn('sh', ['-c', this.commandOverride], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else {
        // Default: use local termux-notification-list
        process = spawn('termux-notification-list', [], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      }
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`notification list command failed with code ${code}: ${stderr}`));
          return;
        }
        
        try {
          const notifications = JSON.parse(stdout);
          const validatedNotifications = z.array(NotificationSchema).parse(notifications);
          resolve(validatedNotifications);
        } catch (error) {
          reject(new Error(`Failed to parse notification data: ${error}`));
        }
      });
      
      process.on('error', (error) => {
        reject(new Error(`Failed to execute notification list command: ${error.message}`));
      });
    });
  }
}
