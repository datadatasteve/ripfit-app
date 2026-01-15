import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  // Possible values: 'light', 'dark', 'system'
  const [themeMode, setThemeMode] = useState(() => {
    // Get saved preference from localStorage, default to 'system'
    return localStorage.getItem('theme-mode') || 'system';
  });

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    
    // Remove any existing theme attribute
    root.removeAttribute('data-theme');
    
    if (themeMode === 'system') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      // Use explicit theme
      root.setAttribute('data-theme', themeMode);
    }
    
    // Save preference
    localStorage.setItem('theme-mode', themeMode);
  }, [themeMode]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e) => {
      const root = document.documentElement;
      root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  const value = {
    themeMode,
    setThemeMode,
    isLight: themeMode === 'light' || (themeMode === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches),
    isDark: themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
