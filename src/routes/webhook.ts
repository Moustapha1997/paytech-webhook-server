import { Router, Request, Response } from 'express';
import { PayTechNotification } from '../types/paytech';
import { supabase } from '../config/supabase';
import { sha256 } from '../utils/crypto';

const router = Router();

async function handleWebhook(req: Request, res: Response) {
    console.log('=== WEBHOOK CALLED ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);

    try {
        const notification = req.body as PayTechNotification;
        
        // Parse custom_field si c'est une string
        const customField = typeof notification.custom_field === 'string' 
            ? JSON.parse(notification.custom_field)
            : notification.custom_field;

        console.log('Custom field:', customField);
        
        if (notification.type_event !== 'sale_complete') {
            console.log('Ignoring non-sale event:', notification.type_event);
            res.status(200).json({ status: 'ignored' });
            return;
        }

        // Vérifier la signature
        const apiKeyHash = sha256(process.env.PAYTECH_API_KEY!);
        const apiSecretHash = sha256(process.env.PAYTECH_API_SECRET!);

        console.log('Hash verification:', {
            received_key: notification.api_key_sha256,
            calculated_key: apiKeyHash,
            matches: apiKeyHash === notification.api_key_sha256
        });

        if (
            apiKeyHash !== notification.api_key_sha256 || 
            apiSecretHash !== notification.api_secret_sha256
        ) {
            console.error('Invalid signature');
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        // Récupérer la réservation en attente
        const { data: pendingReservation, error: fetchError } = await supabase
            .from('reservations_pending')
            .select('*')
            .eq('ref_command', customField.ref_command)
            .single();

        console.log('Pending reservation:', pendingReservation);

        if (fetchError || !pendingReservation) {
            console.error('Reservation not found:', customField.ref_command);
            res.status(404).json({ error: 'Reservation not found' });
            return;
        }

        // Créer la réservation confirmée
        const confirmedReservation = {
            ...pendingReservation.reservation_data,
            statut: 'validee',
            payment_status: 'completed',
            payment_ref: notification.ref_command,
            payment_method: notification.payment_method,
            client_phone: notification.client_phone,
            payment_details: notification,
            confirmed_at: new Date().toISOString()
        };

        console.log('Confirmed reservation data:', confirmedReservation);

        // Insérer dans reservations
        const { error: insertError } = await supabase
            .from('reservations')
            .insert([confirmedReservation]);

        if (insertError) {
            console.error('Insert error:', insertError);
            res.status(500).json({ error: 'Insert failed' });
            return;
        }

        // Supprimer de reservations_pending
        const { error: deleteError } = await supabase
            .from('reservations_pending')
            .delete()
            .eq('ref_command', customField.ref_command);

        if (deleteError) {
            console.warn('Delete warning:', deleteError);
        }

        console.log('Webhook processing completed successfully');
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
}

// Route IPN
router.post('/ipn', handleWebhook);

// Route de test
router.get('/health', (_, res) => {
    res.status(200).json({ status: 'healthy' });
});

export default router;
