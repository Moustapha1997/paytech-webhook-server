import { Router, Request, Response } from 'express';
import { PayTechNotification, CustomField } from '../types/paytech';
import { supabase } from '../config/supabase';
import { sha256 } from '../utils/crypto';

const router = Router();

async function handleWebhook(req: Request, res: Response) {
    console.log('=== WEBHOOK HANDLER STARTED ===');
    
    try {
        // Parse les données reçues
        const notificationData = req.headers['content-type']?.includes('application/x-www-form-urlencoded')
            ? req.body
            : typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        console.log('Received notification data:', notificationData);

        const notification = notificationData as PayTechNotification;
        
        // Parse custom_field
        let customField: CustomField;
        try {
            customField = typeof notification.custom_field === 'string'
                ? JSON.parse(notification.custom_field)
                : notification.custom_field;

            if (!customField.ref_command) {
                throw new Error('Missing ref_command in custom_field');
            }

            console.log('Parsed custom field:', customField);
        } catch (e) {
            console.error('Error parsing custom_field:', e);
            return res.status(400).json({ error: 'Invalid custom_field format' });
        }

        if (notification.type_event !== 'sale_complete') {
            console.log('Ignoring non-sale event:', notification.type_event);
            return res.status(200).json({ status: 'ignored' });
        }

        // Vérification des signatures
        const myApiKey = process.env.PAYTECH_API_KEY!;
        const myApiSecret = process.env.PAYTECH_API_SECRET!;
        
        const apiKeyHash = sha256(myApiKey);
        const apiSecretHash = sha256(myApiSecret);

        console.log('Signature verification:', {
            received_key_hash: notification.api_key_sha256,
            calculated_key_hash: apiKeyHash,
            matches: apiKeyHash === notification.api_key_sha256
        });

        if (
            apiKeyHash !== notification.api_key_sha256 || 
            apiSecretHash !== notification.api_secret_sha256
        ) {
            console.error('Invalid signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Récupération de la réservation en attente
        const { data: pendingReservation, error: fetchError } = await supabase
            .from('reservations_pending')
            .select('*')
            .eq('ref_command', customField.ref_command)
            .single();

        console.log('Found pending reservation:', pendingReservation);

        if (fetchError || !pendingReservation) {
            console.error('Reservation not found:', customField.ref_command);
            return res.status(404).json({ error: 'Reservation not found' });
        }

        // Création de la réservation confirmée
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

        console.log('Preparing confirmed reservation:', confirmedReservation);

        // Insertion dans reservations
        const { error: insertError } = await supabase
            .from('reservations')
            .insert([confirmedReservation]);

        if (insertError) {
            console.error('Insert error:', insertError);
            return res.status(500).json({ error: 'Insert failed' });
        }

        // Suppression de reservations_pending
        await supabase
            .from('reservations_pending')
            .delete()
            .eq('ref_command', customField.ref_command);

        console.log('Webhook processing completed successfully');
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Webhook processing error:', error);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
}

// Routes
router.post('/ipn', handleWebhook);
router.get('/health', (_, res) => res.status(200).json({ status: 'healthy' }));

export default router;
