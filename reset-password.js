const bcrypt = require('bcrypt');
const { query } = require('./config/database');

async function resetPassword() {
    const email = 'john@kenyahardware.co.ke';
    const newPassword = 'Test123!';
    
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    
    try {
        const result = await query(
            'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING email',
            [passwordHash, email]
        );
        
        if (result.rows.length > 0) {
            console.log(`✅ Password reset successful for ${email}`);
            console.log(`New password: ${newPassword}`);
        } else {
            console.log(`❌ User not found: ${email}`);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
    
    process.exit();
}

resetPassword();