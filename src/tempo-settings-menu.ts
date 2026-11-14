export interface SettingsItem {
  commandId: number;
  label: string;
  type: Electron.MenuItem['type'];
  checked: boolean;
  enabled: boolean;
  description?: string;
  icon?: string;
  children: SettingsItem[];
}
