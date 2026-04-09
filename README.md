# 🛒 POS System - Complete Point of Sale Application

A fully functional Point of Sale (POS) system built with React, featuring inventory management, employee tracking, sales processing, shift management, and comprehensive reporting.

## ✨ Features

### 📊 Dashboard
- Real-time sales statistics
- Revenue and transaction metrics
- Top products and recent sales
- Low stock alerts
- Weekly sales chart

### 🛍️ Point of Sale (POS)
- Product browsing with category filters
- Shopping cart management
- Discount application (percentage or fixed)
- Automatic tax calculation
- Multiple payment methods (Cash, Card, Mobile)
- Receipt generation
- Barcode scanning support

### 📦 Inventory Management
- Complete product inventory tracking
- Stock level monitoring
- Low stock alerts
- Manual stock adjustments
- Inventory value tracking
- Product categories

### 💰 Sales History
- Complete transaction history
- Sales filtering by date and payment method
- Transaction details view
- Receipt printing
- Sales analytics

### 👥 Employee Management
- Employee profiles with roles
- Hourly rate tracking
- Active/inactive status
- Role-based access (Admin, Manager, Cashier)
- Employee search and filtering
- Firebase Auth account creation from Admin panel
- Realtime sync between open systems
- Admin live count of currently open systems

### ⏰ Shift Management
- Clock in/out functionality
- Break time tracking
- Shift duration calculation
- Sales per shift tracking
- Active shift monitoring
- Shift history

### 📈 Reports & Analytics
- Revenue and profit metrics
- Daily and hourly sales charts
- Top products analysis
- Sales by category
- Payment method distribution
- Export reports to JSON
- Custom date range filtering

## 🚀 Quick Start

### Prerequisites
- Node.js 16.x or higher
- npm or yarn package manager

### Installation

1. **Navigate to the project directory**
   ```bash
   cd pos-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the application**
   ```bash
   npm start
   ```

4. **Open your browser**
   
   The application will automatically open at `http://localhost:3000`

   If it doesn't open automatically, navigate to:
   ```
   http://localhost:3000
   ```

## 📁 Project Structure

```
pos-app/
├── public/
│   └── index.html          # HTML template
├── src/
│   ├── components/         # Reusable components
│   │   ├── Modal.js        # Modal dialog component
│   │   ├── Input.js        # Form input component
│   │   ├── Select.js       # Dropdown select component
│   │   └── Notification.js # Toast notification component
│   ├── data/
│   │   └── demoData.js     # Initial data & localStorage utilities
│   ├── pages/              # Page components
│   │   ├── Dashboard.js    # Main dashboard
│   │   ├── POS.js          # Point of sale interface
│   │   ├── Products.js     # Product management
│   │   ├── Sales.js        # Sales history
│   │   ├── Inventory.js    # Inventory management
│   │   ├── Shifts.js       # Shift management
│   │   ├── Employees.js    # Employee management
│   │   └── Reports.js      # Reports & analytics
│   ├── App.js              # Main app component with navigation
│   ├── index.css           # Global styles & Tailwind directives
│   └── index.js            # React entry point
├── package.json            # Dependencies & scripts
├── tailwind.config.js      # Tailwind CSS configuration
└── postcss.config.js       # PostCSS configuration
```

## 🎨 Tech Stack

- **Frontend Framework**: React 18.2.0
- **Styling**: Tailwind CSS 3.4.0
- **Icons**: Lucide React
- **Date Handling**: date-fns
- **Authentication**: Firebase Auth
- **Data Persistence**: Firestore (users, employees, products, inventoryLogs, sales, shifts, systemSessions) + localStorage (fallback/cache)
- **Build Tool**: Create React App (react-scripts)

## Firebase Setup

1. Create a Firebase project and enable:
   - `Authentication > Email/Password`
   - `Firestore Database`
2. Copy `.env.example` to `.env` and complete Firebase keys.
3. Install dependency:
   ```bash
   npm install firebase
   ```
4. (Recommended) Apply security rules using `firebase.rules.example`.

### Data model (implemented)
- `users/{uid}`: auth profile + role + status
- `employees/{uid}`: employee business data linked by uid

Admin can create employee accounts from **Employees > Add Employee** (creates Auth user + Firestore docs).

## 💾 Data Storage

This application uses **localStorage** for data persistence. All data is stored locally in your browser, including:

- Products and inventory
- Sales transactions
- Employees and shifts
- Configuration settings

### Demo Data

The application comes with pre-loaded demo data including:
- Sample products across multiple categories
- Example employees with different roles
- Sample sales transactions
- Initial shift data

### Resetting Data

To reset all data to the initial demo state, you can:
1. Open browser DevTools (F12)
2. Go to Application/Storage → Local Storage
3. Clear localStorage for `http://localhost:3000`
4. Refresh the page

## 📱 Responsive Design

The application is fully responsive and works on:
- Desktop browsers (1280px+)
- Tablets (768px - 1279px)
- Mobile devices (< 768px)

## 🔧 Configuration

### Customizing Colors

Edit `tailwind.config.js` to change the color scheme:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          // Customize your primary colors
        }
      }
    }
  }
}
```

### Tax Rate

Tax rate is set in `src/pages/POS.js` (default: 16%):

```javascript
const TAX_RATE = 0.16;
```

### Currency

Currency formatting is handled in `src/data/demoData.js`:

```javascript
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
};
```

## 🎯 Usage Guide

### Processing a Sale

1. Navigate to **POS** from the sidebar
2. Search or browse products
3. Click products to add them to cart
4. Adjust quantities or remove items
5. Apply discounts if needed
6. Click **Checkout**
7. Select payment method
8. Click **Complete Sale**
9. Print or save receipt

### Managing Inventory

1. Go to **Inventory** from the sidebar
2. View stock levels and alerts
3. Click **Adjust** to modify stock
4. Add or remove inventory
5. Enter reason for adjustment

### Managing Shifts

1. Go to **Shifts** from the sidebar
2. Click **Clock In** to start a shift
3. Take breaks using **Start Break**
4. Click **End Break** when returning
5. Click **Clock Out** to end shift

### Viewing Reports

1. Navigate to **Reports**
2. Select date range (Today, Week, Month, Year, or Custom)
3. View charts and analytics
4. Click **Export Report** to download JSON

## 🔒 Security Notes

- Authentication is now handled by Firebase Auth.
- Employee access/roles depend on documents in `users/{uid}`.
- For production, enforce Firestore rules and add backend functions for advanced admin actions (e.g. full user deletion in Auth).

## 🐛 Troubleshooting

### Port Already in Use

If port 3000 is already in use, the app will automatically try the next available port (3001, 3002, etc.)

### Data Not Persisting

- Ensure cookies and localStorage are enabled
- Check browser privacy settings
- Try clearing cache and reloading

### Styles Not Loading

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm start
```

## 📄 License

This project is provided as-is for educational and demonstration purposes.

## 🤝 Support

For issues or questions:
- Check the code comments for detailed explanations
- Review the component files for implementation details
- All components are documented with inline comments

## 🎉 Getting Started with Development

To modify or extend the application:

1. **Add a new page**:
   - Create a new component in `src/pages/`
   - Add it to the `SIDEBAR_ITEMS` array in `src/App.js`

2. **Add a new component**:
   - Create component in `src/components/`
   - Import and use in any page

3. **Modify data structure**:
   - Edit `src/data/demoData.js`
   - Update initial data and utility functions

4. **Customize styling**:
   - Edit `src/index.css` for global styles
   - Modify `tailwind.config.js` for theme customization

---

**Built with ❤️ using React and Tailwind CSS**



curl -s https://loca.lt/mytunnelpassword
npx localtunnel --port 3001