export interface Database {
  public: {
    Tables: {
      User: {
        Row: {
          id: number;
          created_at: string;
          auth_uuid: string;
          email: string;
          name: string | null;
        };
      };
      Measurement: {
        Row: {
          id: number;
          created_at: string;
          heartRate: number;
          timeStamp: string;
          userId: number;
        };
      };
      Alarm: {
        Row: {
          id: number;
          created_at: string;
          updated_at: string;
          userId: number;
          time: string;
          label: string;
          enabled: boolean;
          repeat_days: string[];
        };
      };
    };
  };
}
