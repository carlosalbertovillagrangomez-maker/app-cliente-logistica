import Stripe from 'stripe';

const stripe = new Stripe('sk_test_51TSh9M9QuIIjLWZE5YWUhtXaOgzI0wlUs2AGELJIvi2DFEv5T1I8qUO0uyLJqNWSTlLY5ElEM8WxPk05YdA3AV9b00jHia5iv4');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
        const { phone, name } = req.body;

        // 1. Creamos al cliente en la bóveda de Stripe usando su teléfono como identificador
        const customer = await stripe.customers.create({
            phone: phone,
            name: name,
        });

        // 2. Pedimos permiso para guardar una tarjeta
        const setupIntent = await stripe.setupIntents.create({
            customer: customer.id,
            payment_method_types: ['card'],
        });

        // 3. Devolvemos el secreto a React
        res.status(200).json({ 
            clientSecret: setupIntent.client_secret,
            customerId: customer.id
        });

    } catch (error) {
        console.error("Error en Stripe:", error);
        res.status(500).json({ error: error.message });
    }
}