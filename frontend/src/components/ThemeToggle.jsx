import { useTheme } from '../contexts/ThemeContext';
import './ThemeToggle.css';

function ThemeToggle() {
  const { themeMode, setThemeMode } = useTheme();

  const handleChange = (e) => {
    setThemeMode(e.target.value);
  };

  return (
    <div className="theme-toggle">
      <select 
        value={themeMode} 
        onChange={handleChange}
        className="theme-select"
        aria-label="Select theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </div>
  );
}

export default ThemeToggle;
