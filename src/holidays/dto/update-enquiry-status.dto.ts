import { ListVisaEnquiriesDto, UpdateVisaEnquiryStatusDto } from '../../visas/dto/update-enquiry-status.dto';

// Same shape as the visa enquiry admin DTOs (status, note, paging).
export class UpdateHolidayEnquiryStatusDto extends UpdateVisaEnquiryStatusDto {}
export class ListHolidayEnquiriesDto extends ListVisaEnquiriesDto {}
