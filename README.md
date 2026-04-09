# CAF Management System

This is a responsive single-page web app for animal house management with role-based access (Admin, PI, Student) and tabs for Overview, Tasks, Animal Details, Breeding Strategy, Reports, and Project Summary.

## Features
- Local IndexedDB storage for offline functionality
- SQL database sync for data persistence
- Role-based access control
- Responsive design

## Setup
1. Install Node.js dependencies:
   ```
   npm install
   ```

2. Start the SQL backend server:
   ```
   npm start
   ```

3. Open `index.html` in your browser.

## Demo Logins
- Admin: admin / admin123
- PI: pi / pi123
- Student: student / student123

## Database
The app uses SQLite for data storage. Tables are created automatically on first run.
