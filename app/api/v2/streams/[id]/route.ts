import { NextRequest, NextResponse } from 'next/server';
import { patchStreamSchema } from '@/app/lib/stream-validation';

// 🌟 Make sure the keyword 'export' is exactly here
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // Awaited promise format for Next 15
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    const validationResult = patchStreamSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        {
          type: 'https://streampay.org/errors/validation-error',
          title: 'Bad Request',
          status: 400,
          detail: 'The request payload contains invalid or unknown keys.',
          code: 'INVALID_PAYLOAD_KEYS',
          errors: validationResult.error.flatten().fieldErrors,
        },
        { 
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' }
        }
      );
    }

    const validData = validationResult.data;
    
    return NextResponse.json({ success: true, id, data: validData }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        type: 'https://streampay.org/errors/invalid-json',
        title: 'Malformed JSON',
        status: 400,
        detail: 'The body parsing engine failed to process the raw JSON input.',
      },
      { 
        status: 400,
        headers: { 'Content-Type': 'application/problem+json' }
      }
    );
  }
}