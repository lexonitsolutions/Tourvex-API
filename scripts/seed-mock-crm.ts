import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';

const TZ = 'Asia/Dubai';

// Helper to get date N days ago
function daysAgo(n: number, hours = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hours, 0, 0, 0);
  return d;
}

function daysAhead(n: number, hours = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hours, 0, 0, 0);
  return d;
}

async function run() {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tourvex');
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');

  console.log('Seeding mock CRM data across admin and production...');

  // 1. Update Partners with original logos and links
  const partnerLogos = [
    '/images/destination-01.jpg',
    '/images/destination-02.jpg',
    '/images/destination-03.jpg',
    '/images/destination-a.jpg',
    '/images/destination-b.jpg',
    '/images/destination-c.jpg',
    '/images/destination-d.jpg',
    '/images/destination-05.jpg',
    '/images/karnish-logo.png',
    '/images/logo.png',
  ];
  const partners = await db.collection('partners').find({}).toArray();
  for (let i = 0; i < partners.length; i++) {
    const logo = partnerLogos[i % partnerLogos.length];
    await db.collection('partners').updateOne(
      { _id: partners[i]._id },
      {
        $set: {
          logo,
          href: 'https://karnishtourism.com',
          published: true,
          updatedAt: new Date(),
        },
      },
    );
  }
  console.log(`Updated ${partners.length} partners with original logos and links.`);

  // 2. Customers
  const customerDocs = [
    {
      _id: new Types.ObjectId(),
      email: 'tariq.mansoor@example.com',
      firstName: 'Tariq',
      lastName: 'Mansoor',
      phone: '+971 50 123 4567',
      roles: ['customer'],
      status: 'active',
      active: true,
      preferredCurrency: 'AED',
      preferredLocale: 'en',
      createdAt: daysAgo(28),
      updatedAt: daysAgo(28),
    },
    {
      _id: new Types.ObjectId(),
      email: 'sara.hashimi@example.com',
      firstName: 'Sara',
      lastName: 'Al-Hashimi',
      phone: '+971 52 987 6543',
      roles: ['customer'],
      status: 'active',
      active: true,
      preferredCurrency: 'AED',
      preferredLocale: 'en',
      createdAt: daysAgo(22),
      updatedAt: daysAgo(22),
    },
    {
      _id: new Types.ObjectId(),
      email: 'david.miller@example.co.uk',
      firstName: 'David',
      lastName: 'Miller',
      phone: '+44 7911 123456',
      roles: ['customer'],
      status: 'active',
      active: true,
      preferredCurrency: 'AED',
      preferredLocale: 'en',
      createdAt: daysAgo(17),
      updatedAt: daysAgo(17),
    },
    {
      _id: new Types.ObjectId(),
      email: 'fatima.noor@example.com',
      firstName: 'Fatima',
      lastName: 'Noor',
      phone: '+971 55 456 7890',
      roles: ['customer'],
      status: 'active',
      active: true,
      preferredCurrency: 'AED',
      preferredLocale: 'en',
      createdAt: daysAgo(12),
      updatedAt: daysAgo(12),
    },
    {
      _id: new Types.ObjectId(),
      email: 'ahmed.khan@example.com',
      firstName: 'Ahmed',
      lastName: 'Khan',
      phone: '+971 56 333 4455',
      roles: ['customer'],
      status: 'active',
      active: true,
      preferredCurrency: 'AED',
      preferredLocale: 'en',
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
    },
    {
      _id: new Types.ObjectId(),
      email: 'elena.rostova@example.com',
      firstName: 'Elena',
      lastName: 'Rostova',
      phone: '+971 58 777 8899',
      roles: ['customer'],
      status: 'active',
      active: true,
      preferredCurrency: 'AED',
      preferredLocale: 'en',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    },
  ];

  for (const c of customerDocs) {
    const { _id, ...fields } = c;
    await db.collection('users').updateOne(
      { email: c.email },
      { $set: fields, $setOnInsert: { _id } },
      { upsert: true },
    );
  }
  const dbCustomers = await db.collection('users').find({ roles: 'customer' }).toArray();
  console.log(`Ensured ${dbCustomers.length} customers in database.`);

  // 3. Bookings & Orders & Refunds
  const sampleActivities = [
    { title: 'Burj Khalifa At The Top - 124th & 125th Floor', unitPrice: 152.01, serviceType: 'attraction' },
    { title: 'Evening Desert Safari with BBQ Dinner & Dune Bashing', unitPrice: 285.00, serviceType: 'safari' },
    { title: 'Atlantis Aquaventure & Lost Chambers Combo', unitPrice: 345.00, serviceType: 'waterpark' },
    { title: 'Dubai Marina Luxury Dinner Cruise', unitPrice: 195.00, serviceType: 'cruise' },
    { title: 'Ferrari World Abu Dhabi General Admission', unitPrice: 345.00, serviceType: 'themepark' },
    { title: 'Museum of the Future Priority Entry', unitPrice: 149.00, serviceType: 'attraction' },
    { title: 'Abu Dhabi Full Day City Tour with Sheikh Zayed Mosque', unitPrice: 220.00, serviceType: 'tour' },
    { title: 'Miracle Garden & Global Village VIP Pass', unitPrice: 110.00, serviceType: 'attraction' },
  ];

  const bookingSeeds = [
    // Past days (confirmed)
    { dayAgo: 26, actIdx: 0, custIdx: 0, qty: 2, status: 'confirmed' },
    { dayAgo: 24, actIdx: 1, custIdx: 1, qty: 3, status: 'confirmed' },
    { dayAgo: 21, actIdx: 2, custIdx: 2, qty: 2, status: 'confirmed' },
    { dayAgo: 19, actIdx: 3, custIdx: 3, qty: 4, status: 'confirmed' },
    { dayAgo: 16, actIdx: 4, custIdx: 4, qty: 2, status: 'confirmed' },
    { dayAgo: 14, actIdx: 0, custIdx: 5, qty: 2, status: 'confirmed' },
    { dayAgo: 12, actIdx: 5, custIdx: 0, qty: 1, status: 'confirmed' },
    { dayAgo: 10, actIdx: 6, custIdx: 1, qty: 2, status: 'confirmed' },
    { dayAgo: 8,  actIdx: 1, custIdx: 2, qty: 2, status: 'confirmed' },
    { dayAgo: 7,  actIdx: 7, custIdx: 3, qty: 4, status: 'confirmed' },
    { dayAgo: 5,  actIdx: 2, custIdx: 4, qty: 3, status: 'confirmed' },
    { dayAgo: 4,  actIdx: 3, custIdx: 5, qty: 2, status: 'confirmed' },
    { dayAgo: 3,  actIdx: 0, custIdx: 0, qty: 3, status: 'confirmed' },
    { dayAgo: 2,  actIdx: 4, custIdx: 1, qty: 2, status: 'confirmed' },
    { dayAgo: 1,  actIdx: 5, custIdx: 2, qty: 2, status: 'confirmed' },
    { dayAgo: 0,  actIdx: 1, custIdx: 3, qty: 2, status: 'confirmed' },
    // Special states: cancellation requested & refund
    { dayAgo: 3,  actIdx: 6, custIdx: 4, qty: 2, status: 'cancellation_requested' },
    { dayAgo: 6,  actIdx: 2, custIdx: 5, qty: 2, status: 'refunded' },
  ];

  await db.collection('bookings').deleteMany({ reference: { $regex: '^BK-2026-' } });
  await db.collection('orders').deleteMany({ orderReference: { $regex: '^OR-2026-' } });
  await db.collection('vouchers').deleteMany({ bookingReference: { $regex: '^BK-2026-' } });
  await db.collection('refunds').deleteMany({ bookingReference: { $regex: '^BK-2026-' } });
  await db.collection('invoices').deleteMany({ invoiceNumber: { $regex: '^INV-2026-' } });

  const vouchersToInsert = [];
  const refundsToInsert = [];
  const invoicesToInsert = [];

  for (let i = 0; i < bookingSeeds.length; i++) {
    const s = bookingSeeds[i];
    const act = sampleActivities[s.actIdx];
    const cust = dbCustomers[s.custIdx % dbCustomers.length];
    const bookingRef = `BK-2026-${String(1001 + i).padStart(4, '0')}`;
    const orderRef = `OR-2026-${String(2001 + i).padStart(4, '0')}`;
    const invoiceNum = `INV-2026-${String(3001 + i).padStart(4, '0')}`;
    const vchCode = `VCH-2026-${String(4001 + i).padStart(4, '0')}`;

    const createdAt = daysAgo(s.dayAgo, 10 + (i % 8));
    const confirmedAt = s.status !== 'pending_payment' ? createdAt : undefined;
    const serviceDate = daysAhead(10 - s.dayAgo);

    const subtotal = Math.round(act.unitPrice * s.qty * 100) / 100;
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    const bookingDoc = {
      _id: new Types.ObjectId(),
      reference: bookingRef,
      orderReference: orderRef,
      cartItemId: `item-${i + 1}`,
      customerId: cust._id,
      serviceType: 'activity',
      title: act.title,
      quantity: s.qty,
      unitPrice: act.unitPrice,
      subtotal,
      tax,
      total,
      partnerDiscount: 0,
      currency: 'AED',
      status: s.status,
      serviceDate,
      refundable: true,
      freeCancellationUntil: daysAhead(8 - s.dayAgo),
      cancellationPolicy: 'Free cancellation until 48 hours before service; otherwise non-refundable.',
      confirmedAt,
      paymentReference: `pi_mock_${bookingRef}`,
      customerDetails: {
        fullName: `${cust.firstName} ${cust.lastName}`,
        email: cust.email,
        phone: cust.phone,
      },
      createdAt,
      updatedAt: createdAt,
    };

    await db.collection('bookings').insertOne(bookingDoc);

    // Order
    await db.collection('orders').insertOne({
      _id: new Types.ObjectId(),
      orderReference: orderRef,
      userId: cust._id,
      cartId: new Types.ObjectId(),
      status: s.status === 'refunded' ? 'paid' : s.status === 'cancellation_requested' ? 'paid' : 'paid',
      active: true,
      bookingReferences: [bookingRef],
      subtotalMinor: Math.round(subtotal * 100),
      discountMinor: 0,
      taxMinor: Math.round(tax * 100),
      totalMinor: Math.round(total * 100),
      currency: 'AED',
      paymentMode: 'mock',
      paymentIntentId: `pi_mock_${orderRef}`,
      createdAt,
      updatedAt: createdAt,
    });

    // Invoice
    invoicesToInsert.push({
      _id: new Types.ObjectId(),
      invoiceNumber: invoiceNum,
      bookingId: bookingDoc._id,
      bookingReference: bookingRef,
      orderReference: orderRef,
      status: s.status === 'refunded' ? 'refunded' : 'paid',
      kind: 'invoice',
      issuedAt: createdAt,
      paidAt: createdAt,
      seller: {
        legalName: 'Karnish Tourism LLC',
        address: 'Al Fahidi, Bur Dubai, Dubai, UAE',
        taxNumber: '100234567800003',
        email: 'billing@karnishtourism.com',
        phone: '+971 4 123 4567',
        registrationLabel: 'TRN',
        registrationNumber: '100234567800003',
      },
      customer: {
        userId: cust._id,
        name: `${cust.firstName} ${cust.lastName}`,
        email: cust.email,
        phone: cust.phone,
      },
      currency: 'AED',
      lines: [
        {
          label: act.title,
          qty: s.qty,
          unitAmount: act.unitPrice,
          total: subtotal,
        },
      ],
      subtotal,
      tax,
      total,
      createdAt,
      updatedAt: createdAt,
    });

    // Voucher
    if (s.status === 'confirmed' || s.status === 'cancellation_requested') {
      vouchersToInsert.push({
        _id: new Types.ObjectId(),
        code: vchCode,
        bookingId: bookingDoc._id,
        bookingReference: bookingRef,
        status: s.dayAgo > 15 ? 'redeemed' : 'issued',
        issuedAt: createdAt,
        redeemedAt: s.dayAgo > 15 ? daysAgo(s.dayAgo - 2) : undefined,
        resendCount: 0,
        createdAt,
        updatedAt: createdAt,
      });
    }

    // Refund ledger if refunded
    if (s.status === 'refunded') {
      refundsToInsert.push({
        _id: new Types.ObjectId(),
        bookingId: bookingDoc._id,
        bookingReference: bookingRef,
        orderReference: orderRef,
        amount: total,
        amountMinor: Math.round(total * 100),
        currency: 'AED',
        reason: 'Customer requested cancellation within free cancellation window.',
        mode: 'mock',
        status: 'succeeded',
        providerRefundId: `re_mock_${bookingRef}`,
        idempotencyKey: `idem_${bookingRef}`,
        createdAt: daysAgo(5),
        updatedAt: daysAgo(5),
      });
    }
  }

  if (vouchersToInsert.length) await db.collection('vouchers').insertMany(vouchersToInsert);
  if (refundsToInsert.length) await db.collection('refunds').insertMany(refundsToInsert);
  if (invoicesToInsert.length) await db.collection('invoices').insertMany(invoicesToInsert);

  console.log(`Seeded ${bookingSeeds.length} bookings, ${vouchersToInsert.length} vouchers, ${refundsToInsert.length} refunds, ${invoicesToInsert.length} invoices.`);

  // 4. Leads & Enquiries
  await db.collection('leads').deleteMany({ leadNumber: { $regex: '^LD-2026-' } });

  const leadSeeds = [
    {
      leadNumber: 'LD-2026-0001',
      source: 'holiday',
      sourceRef: 'HQ-2026-001',
      stage: 'new',
      status: 'new',
      priority: 'high',
      contact: { name: 'Rashid Al-Nuaimi', email: 'rashid.nuaimi@example.com', phone: '+971 50 223 3445' },
      channel: 'web_form',
      subject: 'Holiday enquiry: Dubai Skyline City Break (4 pax)',
      summary: 'Inquiry for 4 adults for the 4-day Dubai Skyline break with deluxe desert safari upgrade.',
      catalogRef: { type: 'holiday', slug: 'dubai-skyline-city-break', title: 'Dubai Skyline City Break' },
      estimatedValue: 6360,
      currency: 'AED',
      dayAgo: 1,
    },
    {
      leadNumber: 'LD-2026-0002',
      source: 'cruise',
      sourceRef: 'CQ-2026-002',
      stage: 'contacted',
      status: 'contacted',
      priority: 'urgent',
      contact: { name: 'Oliver Smith', email: 'oliver.smith@example.co.uk', phone: '+44 7700 900123' },
      channel: 'web_form',
      subject: 'Cruise enquiry: Arabian Gulf Glamour - Horizon Star',
      summary: 'Balcony suite request for 2 passengers, embarking from Dubai Harbour next month.',
      catalogRef: { type: 'cruise', slug: 'arabian-gulf-glamour', title: 'Arabian Gulf Glamour' },
      estimatedValue: 12400,
      currency: 'AED',
      dayAgo: 2,
    },
    {
      leadNumber: 'LD-2026-0003',
      source: 'visa',
      sourceRef: 'VQ-2026-003',
      stage: 'qualified',
      status: 'qualified',
      priority: 'high',
      contact: { name: 'Ananya Sharma', email: 'ananya.sharma@example.in', phone: '+91 98200 12345' },
      channel: 'web_form',
      subject: 'Visa enquiry: UAE 60 Days Tourist Visa',
      summary: 'Family visa application for 3 adults and 1 child travelling in November.',
      catalogRef: { type: 'visa', slug: 'uae-60-days-tourist-visa', title: 'UAE 60 Days Tourist Visa' },
      estimatedValue: 1450,
      currency: 'AED',
      dayAgo: 4,
    },
    {
      leadNumber: 'LD-2026-0004',
      source: 'event',
      sourceRef: 'EQ-2026-004',
      stage: 'quoted',
      status: 'quoted',
      priority: 'normal',
      contact: { name: 'Karim Zaki', email: 'karim.zaki@example.com', phone: '+971 55 999 1122' },
      channel: 'web_form',
      subject: 'Event enquiry: Symphony under the Stars - VIP Table',
      summary: 'VIP table booking enquiry for 6 corporate clients at Dubai Opera.',
      catalogRef: { type: 'event', slug: 'symphony-under-the-stars', title: 'Symphony under the Stars' },
      estimatedValue: 4500,
      currency: 'AED',
      dayAgo: 6,
    },
    {
      leadNumber: 'LD-2026-0005',
      source: 'holiday',
      sourceRef: 'HQ-2026-005',
      stage: 'won',
      status: 'won',
      priority: 'high',
      contact: { name: 'Mona Al-Sabah', email: 'mona.sabah@example.com', phone: '+965 9912 3456' },
      channel: 'web_form',
      subject: 'Holiday enquiry: Maldives Lagoon Escape (5 nights)',
      summary: 'Confirmed overwater bungalow booking for honeymoon couple.',
      catalogRef: { type: 'holiday', slug: 'maldives-lagoon-escape', title: 'Maldives Lagoon Escape' },
      estimatedValue: 13800,
      currency: 'AED',
      dayAgo: 8,
    },
    {
      leadNumber: 'LD-2026-0006',
      source: 'holiday',
      sourceRef: 'HQ-2026-006',
      stage: 'new',
      status: 'new',
      priority: 'normal',
      contact: { name: 'Liam O’Connor', email: 'liam.oc@example.ie', phone: '+353 87 123 4567' },
      channel: 'web_form',
      subject: 'Holiday enquiry: Dubai Stopover Express',
      summary: '48-hour Dubai stopover with airport transfers and desert safari.',
      catalogRef: { type: 'holiday', slug: 'dubai-stopover-express', title: 'Dubai Stopover Express' },
      estimatedValue: 2380,
      currency: 'AED',
      dayAgo: 1,
    },
    {
      leadNumber: 'LD-2026-0007',
      source: 'cruise',
      sourceRef: 'CQ-2026-007',
      stage: 'qualified',
      status: 'qualified',
      priority: 'normal',
      contact: { name: 'Sophie Martin', email: 'sophie.m@example.fr', phone: '+33 6 12 34 56 78' },
      channel: 'web_form',
      subject: 'Cruise enquiry: Omani Fjords & Musandam Expedition',
      summary: 'Inquiry for twin cabin on 4-day Musandam sailing.',
      catalogRef: { type: 'cruise', slug: 'omani-fjords-expedition', title: 'Omani Fjords Expedition' },
      estimatedValue: 5600,
      currency: 'AED',
      dayAgo: 5,
    },
    {
      leadNumber: 'LD-2026-0008',
      source: 'visa',
      sourceRef: 'VQ-2026-008',
      stage: 'contacted',
      status: 'contacted',
      priority: 'high',
      contact: { name: 'Chen Wei', email: 'chen.wei@example.cn', phone: '+86 138 0013 8000' },
      channel: 'web_form',
      subject: 'Visa enquiry: UAE 30 Days Express Visa',
      summary: 'Urgent business visa consultation for Dubai Expo delegation.',
      catalogRef: { type: 'visa', slug: 'uae-30-days-express-visa', title: 'UAE 30 Days Express Visa' },
      estimatedValue: 950,
      currency: 'AED',
      dayAgo: 3,
    },
    {
      leadNumber: 'LD-2026-0009',
      source: 'event',
      sourceRef: 'EQ-2026-009',
      stage: 'won',
      status: 'won',
      priority: 'urgent',
      contact: { name: 'Faisal Al-Otaibi', email: 'faisal.otaibi@example.com', phone: '+966 50 111 2233' },
      channel: 'web_form',
      subject: 'Event enquiry: Desert Beats Music Festival VIP',
      summary: 'Purchased 4 VIP passes with helicopter transfer package.',
      catalogRef: { type: 'event', slug: 'desert-beats-festival', title: 'Desert Beats Festival' },
      estimatedValue: 7200,
      currency: 'AED',
      dayAgo: 9,
    },
    {
      leadNumber: 'LD-2026-0010',
      source: 'holiday',
      sourceRef: 'HQ-2026-010',
      stage: 'lost',
      status: 'lost',
      priority: 'low',
      contact: { name: 'Markus Weber', email: 'markus.w@example.de', phone: '+49 170 1234567' },
      channel: 'web_form',
      subject: 'Holiday enquiry: RAK Adventure Peaks',
      summary: 'Dates did not align with client work schedule; cancelled inquiry.',
      catalogRef: { type: 'holiday', slug: 'rak-adventure-peaks', title: 'RAK Adventure Peaks' },
      estimatedValue: 3100,
      currency: 'AED',
      dayAgo: 14,
    },
  ];

  await db.collection('leads').deleteMany({ reference: { $regex: '^LD-2026-' } });

  for (const l of leadSeeds) {
    const createdAt = daysAgo(l.dayAgo, 11);
    await db.collection('leads').insertOne({
      _id: new Types.ObjectId(),
      reference: l.leadNumber,
      source: l.source,
      sourceRef: l.sourceRef,
      status: l.status,
      priority: l.priority,
      name: l.contact.name,
      email: l.contact.email,
      phone: l.contact.phone,
      subject: l.subject,
      message: l.summary,
      catalog: l.catalogRef,
      estimatedValue: l.estimatedValue,
      currency: l.currency,
      tags: [l.source, l.priority],
      timeline: [
        {
          id: `tl-1-${l.leadNumber}`,
          at: createdAt,
          type: 'created',
          actorName: 'System Webhook',
          text: `Enquiry received online via website catalog for ${l.catalogRef.title}`,
        },
        ...(l.stage !== 'new'
          ? [
              {
                id: `tl-2-${l.leadNumber}`,
                at: daysAgo(Math.max(0, l.dayAgo - 1), 14),
                type: 'status',
                from: 'new',
                to: l.stage,
                actorName: 'Local Developer',
                text: `Lead progressed to stage ${l.stage}`,
              },
            ]
          : []),
      ],
      createdAt,
      updatedAt: createdAt,
    });
  }
  console.log(`Seeded ${leadSeeds.length} unified leads.`);

  // 5. Support Tickets
  await db.collection('tickets').deleteMany({ number: { $regex: '^TK-100' } });

  const ticketSeeds = [
    {
      number: 'TK-1001',
      subject: 'Request to reschedule Burj Khalifa visit to sunset slot',
      category: 'booking_change',
      priority: 'high',
      status: 'open',
      requester: { name: 'Tariq Mansoor', email: 'tariq.mansoor@example.com' },
      dayAgo: 1,
      messages: [
        {
          id: 'msg-1-1',
          authorType: 'customer',
          authorName: 'Tariq Mansoor',
          body: 'Hello, our flight arrives earlier than planned. Can we move our Burj Khalifa ticket from 14:00 to the 17:30 sunset slot on the same day?',
          internal: false,
          at: daysAgo(1, 9),
        },
      ],
    },
    {
      number: 'TK-1002',
      subject: 'Dietary requirements for Dubai Marina Dhow Cruise dinner',
      category: 'general_enquiry',
      priority: 'normal',
      status: 'open',
      requester: { name: 'Sara Al-Hashimi', email: 'sara.hashimi@example.com' },
      dayAgo: 2,
      messages: [
        {
          id: 'msg-2-1',
          authorType: 'customer',
          authorName: 'Sara Al-Hashimi',
          body: 'Hi, two members of our party require strict vegetarian / Jain meals for the buffet on board. Can you please confirm this is catered for?',
          internal: false,
          at: daysAgo(2, 11),
        },
        {
          id: 'msg-2-2',
          authorType: 'staff',
          authorName: 'Karnish Support Team',
          body: 'Dear Sara, yes! The 5-star international buffet includes dedicated vegetarian and Jain options. We have informed the boat captain and head chef.',
          internal: false,
          at: daysAgo(2, 12),
        },
      ],
    },
    {
      number: 'TK-1003',
      subject: 'Cancellation request for Desert Safari due to illness',
      category: 'cancellation',
      priority: 'urgent',
      status: 'open',
      requester: { name: 'David Miller', email: 'david.miller@example.co.uk' },
      dayAgo: 0,
      messages: [
        {
          id: 'msg-3-1',
          authorType: 'customer',
          authorName: 'David Miller',
          body: 'Unfortunately I have caught a high fever. I am within the 48-hour free cancellation window for booking BK-2026-1017. Could you please process the cancellation and refund?',
          internal: false,
          at: daysAgo(0, 8),
        },
      ],
    },
    {
      number: 'TK-1004',
      subject: 'Tax invoice required with company VAT registration',
      category: 'payment',
      priority: 'low',
      status: 'resolved',
      requester: { name: 'Fatima Noor', email: 'fatima.noor@example.com' },
      dayAgo: 5,
      messages: [
        {
          id: 'msg-4-1',
          authorType: 'customer',
          authorName: 'Fatima Noor',
          body: 'Please provide an official tax invoice with our company TRN number for booking BK-2026-1010.',
          internal: false,
          at: daysAgo(5, 10),
        },
        {
          id: 'msg-4-2',
          authorType: 'staff',
          authorName: 'Accounts Department',
          body: 'Tax invoice INV-2026-3010 has been generated and emailed to your address. Thank you.',
          internal: false,
          at: daysAgo(5, 14),
        },
      ],
    },
    {
      number: 'TK-1005',
      subject: 'Wheelchair accessibility at Ferrari World Abu Dhabi',
      category: 'general_enquiry',
      priority: 'normal',
      status: 'pending',
      requester: { name: 'Ahmed Khan', email: 'ahmed.khan@example.com' },
      dayAgo: 3,
      messages: [
        {
          id: 'msg-5-1',
          authorType: 'customer',
          authorName: 'Ahmed Khan',
          body: 'We are bringing an elderly guest who uses a wheelchair. Is standard wheelchair rental available at the entrance, and are companion passes available?',
          internal: false,
          at: daysAgo(3, 14),
        },
      ],
    },
  ];

  for (const t of ticketSeeds) {
    const createdAt = daysAgo(t.dayAgo, 9);
    await db.collection('tickets').insertOne({
      _id: new Types.ObjectId(),
      number: t.number,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      requester: t.requester,
      messages: t.messages,
      tags: [t.category, t.priority],
      createdAt,
      updatedAt: createdAt,
    });
  }
  console.log(`Seeded ${ticketSeeds.length} support tickets.`);

  // 6. Stock policies
  await db.collection('stock_policies').deleteMany({});
  const stockPolicySeeds = [
    {
      productType: 'activity',
      productRef: 'burj-khalifa-at-the-top',
      variantId: 'general-admission',
      title: 'Burj Khalifa At The Top Tickets',
      variantLabel: 'General Admission',
      defaultCapacity: 60,
      lowStockThreshold: 12,
      stopSale: false,
      active: true,
      unitCost: 110,
    },
    {
      productType: 'activity',
      productRef: 'evening-desert-safari',
      variantId: 'vip-bbq-dune-bashing',
      title: 'Evening Desert Safari with BBQ Dinner',
      variantLabel: 'VIP Dune Bashing',
      defaultCapacity: 45,
      lowStockThreshold: 8,
      stopSale: false,
      active: true,
      unitCost: 160,
    },
    {
      productType: 'activity',
      productRef: 'atlantis-aquaventure-waterpark',
      variantId: 'day-pass-lost-chambers',
      title: 'Atlantis Aquaventure & Lost Chambers Combo',
      variantLabel: 'Day Pass Combo',
      defaultCapacity: 50,
      lowStockThreshold: 10,
      stopSale: false,
      active: true,
      unitCost: 220,
    },
    {
      productType: 'activity',
      productRef: 'dubai-marina-dinner-cruise',
      variantId: 'upper-deck-buffet',
      title: 'Dubai Marina Luxury Dinner Cruise',
      variantLabel: 'Upper Deck VIP',
      defaultCapacity: 40,
      lowStockThreshold: 5,
      stopSale: false,
      active: true,
      unitCost: 120,
    },
  ];

  for (const sp of stockPolicySeeds) {
    await db.collection('stock_policies').insertOne({
      _id: new Types.ObjectId(),
      ...sp,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(1),
    });
  }
  console.log(`Seeded ${stockPolicySeeds.length} stock policies.`);

  await mongoose.disconnect();
  console.log('CRM and Dashboard mock data successfully seeded!');
}

run().catch(async (err) => {
  console.error('Seed failed:', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
