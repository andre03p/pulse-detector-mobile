export interface Database {
  public: {
    Tables: {
      User: {
        Row: {
          id: number;
          created_at: string;
          email: string;
          name: string;
          password: string;
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
    };
  };
}
