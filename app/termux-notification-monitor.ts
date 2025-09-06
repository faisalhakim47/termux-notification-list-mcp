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
        // console.debug('Executing override command:', this.commandOverride);
        process = spawn('sh', ['-c', this.commandOverride], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else {
        // Default: use local termux-notification-list
        // console.debug('Executing local termux-notification-list command');
        process = spawn('termux-notification-list', [], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      }
      
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      
      process.stdout.on('data', (data: Buffer) => {
        stdoutChunks.push(data);
      });
      
      process.stderr.on('data', (data: Buffer) => {
        stderrChunks.push(data);
      });
      
      process.on('close', (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        
        if (code !== 0) {
          console.error(`Command failed with code ${code}, stderr:`, stderr);
          reject(new Error(`notification list command failed with code ${code}: ${stderr}`));
          return;
        }
        
        try {
          // Handle empty output (no notifications)
          const trimmedOutput = stdout.trim();
          if (!trimmedOutput) {
            // console.debug('No notifications found (empty output)');
            resolve([]);
            return;
          }
          
          // console.debug(`Received ${trimmedOutput.length} characters of output`);
          
          const notifications = JSON.parse(trimmedOutput);
          
          // Handle case where command returns null or undefined
          if (!notifications) {
            // console.debug('No notifications found (null response)');
            resolve([]);
            return;
          }
          
          // Ensure we have an array
          const notificationArray = Array.isArray(notifications) ? notifications : [notifications];
          
          try {
            const validatedNotifications = z.array(NotificationSchema).parse(notificationArray);
            // console.debug(`Successfully parsed ${validatedNotifications.length} notifications`);
            resolve(validatedNotifications);
          } catch (validationError) {
            console.warn('Validation failed, returning raw notifications:', validationError);
            // If validation fails, try to filter out invalid notifications
            const validNotifications = notificationArray.filter((notif: any) => {
              try {
                NotificationSchema.parse(notif);
                return true;
              } catch {
                return false;
              }
            });
            // console.debug(`Filtered to ${validNotifications.length} valid notifications out of ${notificationArray.length}`);
            resolve(validNotifications);
          }
        } catch (error) {
          console.error('Failed to parse notification data:', error);
          console.error('Output length:', stdout.length);
          console.error('First 500 chars of stdout:', stdout.substring(0, 500));
          console.error('Last 500 chars of stdout:', stdout.substring(Math.max(0, stdout.length - 500)));
          console.error('Raw stderr:', JSON.stringify(stderr));
          reject(new Error(`Failed to parse notification data: ${error}`));
        }
      });
      
      process.on('error', (error) => {
        console.error('Process execution error:', error);
        reject(new Error(`Failed to execute notification list command: ${error.message}`));
      });
    });
  }
}
