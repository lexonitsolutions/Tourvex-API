import {
  ListVisaEnquiriesDto,
  UpdateVisaEnquiryStatusDto,
} from '../../visas/dto/update-enquiry-status.dto';

// Same shape as the visa enquiry admin DTOs (status, note, paging).
export class UpdateEventEnquiryStatusDto extends UpdateVisaEnquiryStatusDto {}
export class ListEventEnquiriesDto extends ListVisaEnquiriesDto {}
