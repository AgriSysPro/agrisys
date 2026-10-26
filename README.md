# AgriSys - Agricultural Business Management System

AgriSys is a premium, offline-first management application designed for agricultural businesses to track purchases, sales, and financial ledgers with ease. Built with a focus on speed and data integrity, it works entirely in your browser without requiring a server (100% client-side logic).

## 🌟 Key Features

- **Inventory Tracking:** Manage crops and stock with support for weight-based (KG/Maund) and bag-based calculations.
- **Trade Management:** 
  - **Purchasing:** Log purchases from farmers with automated deductions (Bardana, Labour, etc.).
  - **Selling:** Track sales to buyers with receipt image uploads.
- **Financial Ledgers:** Automated bookkeeping for Farmers and Buyers. Track outstanding balances and advances in real-time.
- **Receipt Gallery:** Browse uploaded purchase kanda/scale slips and sale receipt images across all seasons. Search by receipt number, party, crop, type, or date; preview images; select multiple receipts; and download one PDF with computerized receipts beside the uploads, or images only.
- **Professional PDF Receipts:** Generate and print high-quality PDF receipts for every transaction using a custom vector engine.
- **Offline Reliability:** Powered by IndexedDB for local data persistence. Your data stays on your machine.
- **Backups:** Optional encrypted local snapshots and downloadable full backups. Google Drive upload is a manual step; AgriSys does not sync to cloud storage automatically.
- **Premium UI/UX:** Modern, dark-themed dashboard with responsive design and interactive charts.
- **Localization:** Supports Pakistani PKR currency formatting (e.g., `1,25,000.00`) and Urdu digits for specific reports.

## 🚀 Tech Stack

- **Frontend:** Semantic HTML5, Vanilla CSS3 (Custom Design System), JavaScript (ES6+).
- **Database:** IndexedDB (for structured local storage).
- **Icons:** Lucide Icons.
- **PDF Engine:** jsPDF.
- **Calculations:** Math.js for precision financial math.
- **Utilities:** SheetJS (XLSX) for Excel exports.

## 📋 Getting Started

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/NaqeebCh/agrisys.git
   ```
2. **Open the Project:**
   Simply open `index.html` in any modern web browser. No installation or `npm install` is required for basic use.
3. **Usage:**
   - Go to **Settings** to configure your default crop rates and deduction values.
   - Start adding **Farmers** and **Buyers**.
   - Record **Purchases** and **Sales** to automatically update ledgers.

## 📂 Project Structure

- `/js`: Core application logic (Database, UI modules, Utilities).
- `/css`: Custom styles and design system.
- `index.html`: The main entry point of the application.
- `audit/`: Historical bug reviews and fix reports.

## 📄 License

This project is open-source. (Suggest: MIT License)

---
*Developed by Ch Naqeeb*
