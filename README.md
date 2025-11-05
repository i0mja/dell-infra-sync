# Dell Server Manager

Enterprise datacenter infrastructure management platform for Dell servers with automated job execution, vCenter integration, and comprehensive monitoring capabilities.

## 🚀 Features

### Core Functionality
- **Server Management**: Track and manage Dell servers with detailed hardware information
- **Job Scheduling**: Create and execute automated jobs on servers with real-time status tracking
- **vCenter Integration**: Sync and manage VMware vCenter infrastructure
- **User Authentication**: Secure role-based access control (Admin/Viewer roles)
- **Real-time Notifications**: Email (SMTP) and Microsoft Teams webhook integration
- **Dark/Light Mode**: User preference theme switching with persistent storage

### Dashboard & Monitoring
- Server health monitoring and statistics
- Job execution history and status tracking
- Recent activity feeds
- System alerts and notifications

## 🛠️ Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **React Router** for navigation
- **TanStack Query** for data fetching
- **next-themes** for theme management

### Backend (Lovable Cloud)
- **Database**: PostgreSQL via Supabase
- **Authentication**: Supabase Auth with email/password
- **Edge Functions**: Serverless functions for business logic
- **Row Level Security**: Database-level access control

## 📋 Prerequisites

- Node.js 18+ and npm
- Git

## 🏗️ Project Setup

### 1. Clone the Repository

```bash
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

The project uses Lovable Cloud, which automatically manages environment variables. The `.env` file contains:

```env
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
VITE_SUPABASE_PROJECT_ID=<your-project-id>
```

These are automatically configured when using Lovable Cloud.

### 4. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## 🗄️ Database Schema

The application uses the following main tables:

- **profiles**: User profile information
- **user_roles**: Role-based access control (admin/viewer)
- **servers**: Dell server inventory
- **vcenter_connections**: vCenter connection configurations
- **jobs**: Job definitions and execution history
- **notification_settings**: SMTP and Teams webhook configuration

See `supabase/migrations/` for detailed schema definitions.

## 🔐 Authentication

### First Time Setup

1. Navigate to `/auth`
2. Create an account using the Sign Up tab
3. Sign in with your credentials

### Granting Admin Access

By default, new users have viewer role. To grant admin access:

```sql
-- Run in Supabase SQL editor
UPDATE user_roles 
SET role = 'admin' 
WHERE user_id = '<user-id>';
```

Or use the Lovable Cloud dashboard to manage user roles.

## 📧 Notification Configuration

### SMTP Email Setup

1. Navigate to Settings → SMTP Email
2. Configure your SMTP server details:
   - SMTP Host
   - SMTP Port (default: 587)
   - Username & Password
   - From Email Address

### Microsoft Teams Integration

1. Create an Incoming Webhook in your Teams channel
2. Navigate to Settings → Microsoft Teams
3. Paste the webhook URL

### Notification Preferences

Configure which events trigger notifications in Settings → Preferences:
- Job Completed
- Job Failed
- Job Started

## 🤖 Job Executor

The Python job executor script runs on servers to execute jobs:

```bash
python job-executor.py
```

See [Job Executor Guide](docs/JOB_EXECUTOR_GUIDE.md) for detailed setup instructions.

## 🔄 vCenter Sync

Automated vCenter synchronization is handled by:
1. Edge function: `supabase/functions/vcenter-sync/`
2. Python script: `vcenter-sync-script.py`

See [vCenter Sync Guide](docs/VCENTER_SYNC_GUIDE.md) for configuration details.

## 🏗️ Architecture

```
┌─────────────────┐
│   React App     │
│   (Frontend)    │
└────────┬────────┘
         │
         ├── Supabase Client
         │
┌────────┴────────────────────────────┐
│      Lovable Cloud (Backend)        │
├─────────────────────────────────────┤
│  • PostgreSQL Database              │
│  • Authentication & Authorization   │
│  • Edge Functions                   │
│  • Real-time Subscriptions          │
│  • Row Level Security (RLS)         │
└────────┬────────────────────────────┘
         │
    ┌────┴────┐
    │ Servers │
    │ + Jobs  │
    └─────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

## 🚀 Deployment

### Via Lovable

1. Open [Lovable Project](https://lovable.dev/projects/db36c863-cc4b-4aa7-a480-c8687035c1f7)
2. Click **Share** → **Publish**
3. Your app will be deployed automatically

### Custom Domain

1. Navigate to Project → Settings → Domains
2. Click **Connect Domain**
3. Follow the DNS configuration instructions

Read more: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain)

### Self-Hosting

The application can be self-hosted on any platform supporting Node.js:

```bash
npm run build
npm run preview
```

Ensure environment variables are properly configured in your hosting environment.

## 🔧 Development

### Project Structure

```
├── src/
│   ├── components/      # React components
│   ├── hooks/          # Custom React hooks
│   ├── integrations/   # External integrations (Supabase)
│   ├── lib/            # Utility functions
│   ├── pages/          # Page components
│   └── main.tsx        # Application entry point
├── supabase/
│   ├── functions/      # Edge functions
│   └── migrations/     # Database migrations
├── docs/               # Documentation
├── public/             # Static assets
└── *.py               # Python scripts
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run backup       # Backup database to JSON files
npm run restore      # Restore database from backup
```

### Code Editing Options

**1. Use Lovable (Recommended)**
- Visit the [Lovable Project](https://lovable.dev/projects/db36c863-cc4b-4aa7-a480-c8687035c1f7)
- Changes automatically commit to the repository

**2. Local IDE**
- Clone the repository
- Make changes locally
- Push to sync with Lovable

**3. GitHub Codespaces**
- Open the repository in Codespaces
- Edit and commit directly in the browser

**4. Direct GitHub Editing**
- Navigate to files in GitHub
- Click the edit (pencil) icon
- Commit changes directly

## 📚 Documentation

- **[Self-Hosting Guide](docs/SELF_HOSTING.md)** - One-command deployment for RHEL 9 & Windows Server 2022
- [Backup & Migration Guide](docs/BACKUP_GUIDE.md) - Database backup and migration
- [Job Executor Guide](docs/JOB_EXECUTOR_GUIDE.md)
- [vCenter Sync Guide](docs/VCENTER_SYNC_GUIDE.md)
- [Architecture Overview](ARCHITECTURE.md)
- [Lovable Documentation](https://docs.lovable.dev/)

## 🔒 Security

- All API endpoints are protected with Row Level Security (RLS)
- Authentication required for all non-public routes
- Role-based access control (RBAC) for admin features
- Passwords are hashed using Supabase Auth
- SMTP credentials stored securely in the database

## 🤝 Contributing

1. Clone the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is private and proprietary.

## 🆘 Support

For issues or questions:
1. Check the [documentation](docs/)
2. Review [Lovable Documentation](https://docs.lovable.dev/)
3. Contact your system administrator

---

**Project URL**: https://lovable.dev/projects/db36c863-cc4b-4aa7-a480-c8687035c1f7

Built with ❤️ using [Lovable](https://lovable.dev)
