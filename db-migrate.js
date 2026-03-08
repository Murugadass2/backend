require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function migrate() {
    console.log('Starting database migration...');
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // 1. Add is_premium to users if it doesn't exist
        try {
            await pool.execute('ALTER TABLE users ADD COLUMN is_premium TINYINT(1) DEFAULT 0');
            console.log('✅ Added is_premium column to users table');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('ℹ️ is_premium column already exists');
            } else {
                throw err;
            }
        }

        // 2. Create jobs table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS jobs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(150) NOT NULL,
                company VARCHAR(150) NOT NULL,
                location VARCHAR(150),
                type VARCHAR(50),
                experience VARCHAR(50),
                salary VARCHAR(100),
                description TEXT,
                skills JSON,
                logo VARCHAR(255),
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        console.log('✅ Created/Verified jobs table');

        // 3. Create default admin if not exists
        const adminEmail = 'admin12@gmail.com';
        const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [adminEmail]);

        if (existing.length === 0) {
            const hashedPassword = await bcrypt.hash('Admin@1234', 12);
            await pool.execute(
                'INSERT INTO users (full_name, email, password, is_verified, user_role) VALUES (?, ?, ?, 1, ?)',
                ['Super Admin', adminEmail, hashedPassword, 'admin']
            );
            console.log('✅ Created default Super Admin account');
        } else {
            console.log('ℹ️ Super Admin account already exists');
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
