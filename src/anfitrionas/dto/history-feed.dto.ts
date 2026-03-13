export class HistoryFeedItemDto {
    userId: string;
    name: string;
    avatar: string | null;
    hasUnseen: boolean;
    totalStories: number;
}

export class HistoryFeedResponseDto {
    data: HistoryFeedItemDto[];
}